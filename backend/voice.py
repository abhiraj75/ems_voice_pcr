"""Gnani speech: Prisma STT and Timbre TTS settings and helpers."""
import base64
import io
import json
import os
import re
import wave
from collections.abc import AsyncIterator

import websockets
from dotenv import load_dotenv
from fastapi import HTTPException

from languages import ACKNOWLEDGED, DEFAULT, PHRASES, SPOKEN_LABELS
from schemas import PCR

PRISMA_MODEL = "prisma-v3.0"  # v2.5 is the API default; v3.0 formats vitals far better ("110/70", not "10/70")
STT_TOPIC = "Indian 108 ambulance paramedic patient handoff in Hinglish: vitals, drugs, doses, routes"

# Prisma v3.0 keyterms: words or short phrases to favour, max 200.
EMS_TERMS = [
    "aspirin", "adrenaline", "epinephrine", "nitroglycerin", "salbutamol", "nebulization",
    "ondansetron", "diazepam", "midazolam", "naloxone", "atropine", "amiodarone", "dextrose",
    "glucose", "saline", "ringer", "paracetamol", "diclofenac", "tramadol", "morphine",
    "hydrocortisone", "dexamethasone", "furosemide", "clopidogrel", "heparin", "cannula",
    "diaphoretic", "cyanosis", "intubation", "suction", "oropharyngeal", "nasopharyngeal",
    "defibrillation", "CPR", "SpO", "GCS", "BP", "pulse", "unconscious", "seizure",
]


def gnani_headers() -> dict[str, str]:
    load_dotenv()
    api_key = os.getenv("GNANI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail={"error": "GNANI_API_KEY is not set. Add it to backend/.env."},
        )
    return {"X-API-Key-ID": api_key}


TTS_WS_URL = "wss://api.vachana.ai/api/v1/tts"
STT_RATE = 16000
TTS_RATE = 24000

TIMBRE = {
    "voice": "Lakshmi",
    "model": "timbre-v3.0",
    "language": "en-IN",
    "speed": 0.95,
}


def spoken(field: str, value, lang: str = DEFAULT) -> str:
    p = PHRASES[lang]
    if field == "vital_bp":
        value = str(value).replace("/", p["over"])
    elif isinstance(value, bool):
        value = p["yes"] if value else p["no"]
    elif isinstance(value, float):
        value = f"{value:g}"
    return f"{p['spoken'][field]} {value}"


def spoken_med(med) -> str:
    return " ".join(p for p in (med.name, re.sub(r"(\d)\s*mg\b", r"\1 milligram", med.dose), med.route) if p)


def readback_text(pcr: PCR, lang: str = DEFAULT) -> str:
    """Built from the form fields, never by the LLM, so it says exactly what is on screen."""
    p = PHRASES[lang]
    fields = ["vital_bp", "vital_hr", "vital_rr", "vital_spo2", "vital_gcs", "vital_temp", "pain_scale"]
    said = [spoken(f, getattr(pcr, f), lang) for f in fields if getattr(pcr, f) not in (None, "")]
    lines = [s[0].upper() + s[1:] + "." for s in said]
    meds = [spoken_med(m) for m in pcr.medications if m.name]
    if meds:
        lines.append(p["medications"] + ", ".join(meds) + ".")
    if not lines:
        return p["nothing_to_read"]
    return f"{p['readback']} {' '.join(lines)} {p['please_confirm']}"


def confirm_text(before: PCR, after: PCR, lang: str = DEFAULT) -> str | None:
    """What this turn recorded, read from the form itself, so the medic hears exactly what the agent took."""
    p = PHRASES[lang]
    parts = []
    for field in list(SPOKEN_LABELS) + list(ACKNOWLEDGED):
        old, new = getattr(before, field), getattr(after, field)
        if new == old:
            continue
        if new in (None, ""):
            parts.append(p["cleared"].format(p["spoken"].get(field, field)))
        elif field in ACKNOWLEDGED:
            parts.append(p["acknowledged"][field])
        else:
            parts.append(spoken(field, new, lang))
    old_meds = [m.model_dump() for m in before.medications]
    new_meds = [m.model_dump() for m in after.medications]
    parts += [p["medication"].format(spoken_med(m)) for m in after.medications if m.model_dump() not in old_meds]
    parts += [p["removed"].format(spoken_med(m)) for m in before.medications if m.model_dump() not in new_meds]
    return p["noted"] + ", ".join(parts) + "." if parts else None


def pcm_to_wav(pcm: bytes) -> bytes:
    """Wrap 16 kHz mono PCM16 from the browser in a WAV header for Prisma."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(STT_RATE)
        out.writeframes(pcm)
    return buffer.getvalue()


READBACK_SPEED = 1.1  # the medic already knows the values, so readback can run quicker than questions


async def tts_stream(text: str, language: str = "hi-en", speed: float = TIMBRE["speed"]) -> AsyncIterator[bytes]:
    """Raw PCM16 mono at TTS_RATE from Gnani realtime TTS. Closing the iterator closes the socket,
    which is the only way to cancel a Timbre utterance."""
    async with websockets.connect(TTS_WS_URL, additional_headers=gnani_headers()) as ws:
        await ws.send(json.dumps({
            "text": text, **TIMBRE, "language": language, "speed": speed,
            "audio_config": {"sample_rate": TTS_RATE, "num_channels": 1, "sample_width": 2,
                             "encoding": "linear_pcm", "container": "raw"},
        }))
        carry = b""  # keep frames sample-aligned
        async for raw in ws:
            if isinstance(raw, bytes):
                pcm = raw
            else:
                msg = json.loads(raw)
                if msg["type"] == "complete":
                    break
                if msg["type"] == "error":
                    raise RuntimeError(f"Timbre TTS: {msg.get('message')}")
                if msg["type"] != "audio":
                    continue
                pcm = base64.b64decode(msg["data"]["audio"] or "")
            pcm, carry = carry + pcm, b""
            if len(pcm) % 2:
                pcm, carry = pcm[:-1], pcm[-1:]
            if pcm:
                yield pcm
