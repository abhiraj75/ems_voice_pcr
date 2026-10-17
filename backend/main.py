import json
import os
import re

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from pydantic import ValidationError

from prompts import EXTRACTION_PROMPT
from schemas import PCR, TranscriptRequest

load_dotenv()

app = FastAPI(title="EMS Voice PCR")

STT_URL = "https://api.vachana.ai/stt/v3"
TTS_URL = "https://api.vachana.ai/api/v1/tts/inference"
# Caps on paid Gnani calls per request: 10 x 30s chunks = 5 min of audio; a full readback is ~300 chars.
MAX_CHUNKS = 10
MAX_CHUNK_BYTES = 2_000_000  # 60s of 16 kHz 16-bit mono WAV, Prisma's per-request max
MAX_READBACK_CHARS = 1000

# Prisma bias_list: single words, letters only, max 100.
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


def check(res: httpx.Response, service: str) -> None:
    if res.is_error:
        raise HTTPException(
            status_code=502,
            detail={"error": f"{service} returned {res.status_code}: {res.text[:500]}"},
        )


def groq_client() -> Groq:
    load_dotenv()
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail={"error": "GROQ_API_KEY is not set. Add it to backend/.env."},
        )
    return Groq(api_key=api_key)

_default_origins = (
    "https://ems-voice-pcr.vercel.app,"
    "http://localhost:5173,"
    "http://localhost:4173"
)
allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/transcribe")
async def transcribe(audio: list[UploadFile] = File(...)) -> dict[str, str]:
    if len(audio) > MAX_CHUNKS or any((c.size or 0) > MAX_CHUNK_BYTES for c in audio):
        raise HTTPException(status_code=413, detail={"error": "Recording is too long. Keep it under 5 minutes."})
    try:
        headers = gnani_headers()
        parts = []
        # ponytail: sequential chunk calls, asyncio.gather if latency matters.
        async with httpx.AsyncClient(timeout=60) as client:
            for chunk in audio:
                res = await client.post(
                    STT_URL,
                    headers=headers,
                    files={"audio_file": ("audio.wav", await chunk.read(), "audio/wav")},
                    data={
                        "language_code": "en-IN",
                        "format": "transcribe",
                        "bias_list": ",".join(EMS_TERMS),
                        "bias_score": "1.0",
                    },
                )
                check(res, "Prisma STT")
                parts.append(res.json().get("transcript", "").strip())
        return {"transcript": " ".join(p for p in parts if p)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc


@app.post("/api/extract")
async def extract(payload: TranscriptRequest) -> PCR:
    raw_output = ""
    try:
        completion = groq_client().chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": EXTRACTION_PROMPT},
                {"role": "user", "content": payload.transcript},
            ],
            temperature=0.1,
            max_tokens=2048,
            reasoning_effort="low",
            response_format={"type": "json_object"},
        )
        raw_output = completion.choices[0].message.content or ""
        parsed = json.loads(raw_output)
        return PCR(**parsed)
    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": str(exc), "raw_output": raw_output},
        ) from exc
    except ValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": str(exc), "raw_output": raw_output},
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc


def readback_text(pcr: PCR) -> str:
    """Built from the form fields, never by the LLM, so it says exactly what is on screen."""
    num = lambda v: f"{v:g}" if isinstance(v, float) else str(v)
    lines = []
    if pcr.vital_bp:
        lines.append(f"B P {pcr.vital_bp.replace('/', ' over ')}.")
    for label, value in [
        ("Pulse", pcr.vital_hr),
        ("Respiratory rate", pcr.vital_rr),
        ("S P O 2", pcr.vital_spo2),
        ("G C S", pcr.vital_gcs),
        ("Temperature", pcr.vital_temp),
        ("Pain score", pcr.pain_scale),
    ]:
        if value is not None:
            lines.append(f"{label} {num(value)}.")
    meds = [
        " ".join(p for p in (m.name, re.sub(r"(\d)\s*mg\b", r"\1 milligram", m.dose), m.route) if p)
        for m in pcr.medications
        if m.name
    ]
    if meds:
        lines.append("Medications: " + ", ".join(meds) + ".")
    if not lines:
        return "No vitals or medications recorded."
    return "Readback. " + " ".join(lines) + " Please confirm."


@app.post("/api/readback")
async def readback(pcr: PCR) -> Response:
    text = readback_text(pcr)
    if len(text) > MAX_READBACK_CHARS:
        raise HTTPException(status_code=413, detail={"error": "Too much to read back. Shorten the vitals or medications."})
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(
                TTS_URL,
                headers={**gnani_headers(), "Content-Type": "application/json"},
                json={
                    "text": text,
                    "voice": "Lakshmi",
                    "model": "timbre-v3.0",
                    "language": "en-IN",
                    "speed": 0.95,
                    "audio_config": {"sample_rate": 24000, "encoding": "linear_pcm", "container": "wav"},
                },
            )
            check(res, "Timbre TTS")
        return Response(content=res.content, media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
