import asyncio
import json
import logging
import os
import time
from contextlib import aclosing

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Response, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from starlette.websockets import WebSocketState

from agent import AgentSession, groq_client
from prompts import EXTRACTION_PROMPT
from schemas import PCR, TranscriptRequest
from languages import TTS_CODES
from voice import EMS_TERMS, PRISMA_MODEL, READBACK_SPEED, STT_TOPIC, TIMBRE, gnani_headers, pcm_to_wav, readback_text, tts_stream

load_dotenv()
logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="EMS Voice PCR")

STT_URL = "https://api.vachana.ai/stt/v3"
TTS_URL = "https://api.vachana.ai/api/v1/tts/inference"
# Caps on paid Gnani calls per request: 10 x 30s chunks = 5 min of audio; a full readback is ~300 chars.
MAX_CHUNKS = 10
MAX_CHUNK_BYTES = 2_000_000  # 60s of 16 kHz 16-bit mono WAV, Prisma's per-request max
MAX_READBACK_CHARS = 1000
# Every live agent session spends paid Gnani and Groq calls.
MAX_AGENT_SESSIONS = 3
AGENT_SESSION_SECONDS = 14 * 60
PRESS_CHUNK_BYTES = 960_000  # 30 s of 16 kHz PCM16, Prisma's recommended request size
MAX_PRESS_BYTES = 3_840_000  # 2 min per press
MIN_PRESS_BYTES = 8_000  # 0.25 s: shorter is a tap with no speech
MAX_SESSION_INPUTS = 150  # far above a real run (~25 turns); bounds paid calls from one socket
active_agent_sessions = 0


def redact(text: str) -> str:
    """Mask API keys: library errors can echo request headers, and these strings reach logs."""
    for name in ("GNANI_API_KEY", "GROQ_API_KEY"):
        key = (os.getenv(name) or "").strip()
        if key:
            text = text.replace(key, "***")
    return text


def server_error(exc: Exception, what: str) -> HTTPException:
    """Log the real cause (redacted); send the client a plain message, never the exception text."""
    logger.warning("%s failed: %s: %s", what, type(exc).__name__, redact(str(exc))[:300])
    return HTTPException(status_code=500, detail={"error": f"{what} failed. Please try again."})


def check(res: httpx.Response, service: str) -> None:
    if res.is_error:
        raise HTTPException(
            status_code=502,
            detail={"error": f"{service} returned {res.status_code}: {redact(res.text[:500])}"},
        )


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


async def prisma_transcript(client: httpx.AsyncClient, headers: dict[str, str], wav: bytes) -> str:
    res = await client.post(
        STT_URL,
        headers=headers,
        files={"audio_file": ("audio.wav", wav, "audio/wav")},
        data={
            "language_code": "en-IN",  # takes English and Hindi-English speech, outputs Roman script
            "format": "transcribe",
            "model": PRISMA_MODEL,
            "keyterms": ",".join(EMS_TERMS),
            "topic": STT_TOPIC,
        },
    )
    check(res, "Prisma STT")
    return res.json().get("transcript", "").strip()


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
                parts.append(await prisma_transcript(client, headers, await chunk.read()))
        return {"transcript": " ".join(p for p in parts if p)}
    except HTTPException:
        raise
    except Exception as exc:
        raise server_error(exc, "Transcription") from exc


def extract_pcr(transcript: str) -> PCR:
    raw_output = ""
    try:
        completion = groq_client().chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": EXTRACTION_PROMPT},
                {"role": "user", "content": transcript},
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
        raise server_error(exc, "Report extraction") from exc


@app.post("/api/extract")
async def extract(payload: TranscriptRequest) -> PCR:
    return extract_pcr(payload.transcript)


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
                    **TIMBRE,
                    "audio_config": {"sample_rate": 24000, "encoding": "linear_pcm", "container": "wav"},
                },
            )
            check(res, "Timbre TTS")
        return Response(content=res.content, media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as exc:
        raise server_error(exc, "Readback") from exc


class Speaker:
    """Speaks queued utterances one at a time over Gnani TTS; interrupt() drops the queue and cuts the current one."""

    def __init__(self, ws: WebSocket, session: AgentSession) -> None:
        self.ws = ws
        self.session = session
        self.queue: asyncio.Queue[tuple[str, float]] = asyncio.Queue()  # (text, speed)
        self.current: asyncio.Task | None = None
        self.worker = asyncio.create_task(self._run())

    @property
    def speaking(self) -> bool:
        return self.current is not None and not self.current.done()

    async def _run(self) -> None:
        while True:
            text, speed = await self.queue.get()
            self.current = asyncio.create_task(self._speak(text, speed))
            await asyncio.wait([self.current])

    async def _speak(self, text: str, speed: float) -> None:
        await self.ws.send_json({"type": "speaking", "on": True})
        try:
            # aclosing: on barge-in cancel, close the Timbre socket now (the only way to stop it), not at GC.
            async with aclosing(tts_stream(text[:MAX_READBACK_CHARS], TTS_CODES[self.session.lang], speed)) as stream:
                async for pcm in stream:
                    await self.ws.send_bytes(pcm)
        except Exception as exc:
            msg = exc.detail.get("error") if isinstance(exc, HTTPException) else server_error(exc, "Agent voice").detail["error"]
            await self.ws.send_json({"type": "error", "error": msg})
        finally:
            await self.ws.send_json({"type": "speaking", "on": False})

    async def interrupt(self) -> None:
        while not self.queue.empty():
            self.queue.get_nowait()
        if self.speaking:
            self.current.cancel()
            await self.ws.send_json({"type": "stop_audio"})

    def close(self) -> None:
        self.worker.cancel()
        if self.current:
            self.current.cancel()


@app.websocket("/ws/agent")
async def agent_ws(ws: WebSocket) -> None:
    """Live voice copilot. Browser sends 1024-byte PCM16 16 kHz frames and JSON control messages
    ({type: text|set_pcr|talk_start|talk_end|stop}); server sends JSON events and binary PCM16 24 kHz agent speech."""
    global active_agent_sessions
    # CORS doesn't cover WebSockets, so check the origin by hand.
    if ws.headers.get("origin") not in allowed_origins:
        await ws.close(code=1008)
        return
    await ws.accept()
    if active_agent_sessions >= MAX_AGENT_SESSIONS:
        await ws.send_json({"type": "error", "error": "Too many live sessions right now. Try again shortly."})
        await ws.close()
        return
    active_agent_sessions += 1
    session = AgentSession()
    speaker = Speaker(ws, session)
    turns: set[asyncio.Task] = set()
    # Push-to-talk: we know exactly when the medic spoke, so a press is transcribed whole on release.
    press_audio = bytearray()
    talking = False
    inputs = 0  # presses + typed messages; each costs a paid Prisma and/or Groq call

    async def turn(text: str) -> None:
        await ws.send_json({"type": "transcript", "text": text})
        started = time.monotonic()
        try:
            events = await session.handle_segment(text)
        except HTTPException as exc:
            await ws.send_json({"type": "error", "error": exc.detail.get("error", str(exc.detail))})
            return
        except Exception:  # never drop a turn silently: the medic has to know it wasn't recorded
            logger.exception("agent turn failed")
            await ws.send_json({"type": "error", "error": "That wasn't recorded. Please say it again."})
            return
        logger.info("agent turn %.1fs (rate-limit wait %.1fs, %s)", time.monotonic() - started, session.rate_wait, session.model)
        spoken = []
        for event in events:
            if event["type"] == "say":
                await ws.send_json({"type": "agent_text", "source": event["source"], "text": event.get("display") or event["text"]})
                spoken.append(event["text"])
            else:
                await ws.send_json(event)
        if spoken:  # one utterance: no gap for a new Timbre connection between "Noted" and the next question
            readback = any(e.get("source") == "readback" for e in events)
            speaker.queue.put_nowait((" ".join(spoken), READBACK_SPEED if readback else TIMBRE["speed"]))
        await ws.send_json({"type": "turn_done", "spoke": bool(spoken)})

    def spawn(coro) -> None:
        task = asyncio.create_task(coro)
        turns.add(task)
        task.add_done_callback(turns.discard)

    async def transcribe_press(pcm: bytes) -> None:
        try:
            headers = gnani_headers()
            async with httpx.AsyncClient(timeout=30) as client:
                parts = [await prisma_transcript(client, headers, pcm_to_wav(pcm[i:i + PRESS_CHUNK_BYTES]))
                         for i in range(0, len(pcm), PRESS_CHUNK_BYTES)]
        except Exception as exc:
            logger.warning("press transcription failed: %s", redact(str(exc))[:200])
            await ws.send_json({"type": "error", "error": "Couldn't transcribe that. Please say it again."})
            await ws.send_json({"type": "turn_done", "spoke": False})
            return
        text = " ".join(p for p in parts if p)
        if text:
            await turn(text)
        else:
            await ws.send_json({"type": "error", "error": "Didn't catch that. Please say it again."})
            await ws.send_json({"type": "turn_done", "spoke": False})

    try:
        await ws.send_json({"type": "ready"})
        opening = session.opening()
        await ws.send_json({"type": "agent_text", "source": "question", "text": session.opening_display()})
        speaker.queue.put_nowait((opening, TIMBRE["speed"]))

        async def from_browser() -> None:
            nonlocal talking, inputs
            while True:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    return
                if msg.get("bytes"):
                    if talking and len(press_audio) < MAX_PRESS_BYTES:
                        press_audio.extend(msg["bytes"])
                    continue
                data = json.loads(msg.get("text") or "{}")
                if data.get("type") in ("text", "talk_end") and inputs >= MAX_SESSION_INPUTS:
                    talking = False
                    await ws.send_json({"type": "error", "error": "This session has reached its limit. End it and start a new one."})
                    await ws.send_json({"type": "turn_done", "spoke": False})
                elif data.get("type") == "text" and str(data.get("text", "")).strip():
                    inputs += 1
                    await speaker.interrupt()
                    spawn(turn(str(data["text"])[:2000]))
                elif data.get("type") == "talk_start":
                    talking = True
                    press_audio.clear()
                    await speaker.interrupt()
                elif data.get("type") == "talk_end" and talking:
                    # Take and clear the buffer in one step, so a repeated talk_end can't resend it.
                    talking = False
                    pcm = bytes(press_audio)
                    press_audio.clear()
                    if len(pcm) < MIN_PRESS_BYTES:  # a tap with no speech: don't spend a Prisma call
                        await ws.send_json({"type": "error", "error": "Didn't catch that. Please say it again."})
                        await ws.send_json({"type": "turn_done", "spoke": False})
                    else:
                        inputs += 1
                        spawn(transcribe_press(pcm))
                elif data.get("type") == "set_pcr":
                    try:
                        session.pcr = PCR(**data["pcr"])
                    except (ValidationError, KeyError, TypeError):
                        await ws.send_json({"type": "error", "error": "Invalid PCR edit ignored."})
                elif data.get("type") == "stop":
                    return

        tasks = [asyncio.create_task(from_browser())]
        done, _ = await asyncio.wait(tasks, timeout=AGENT_SESSION_SECONDS, return_when=asyncio.FIRST_COMPLETED)
        if not done:
            await ws.send_json({"type": "error", "error": "Session time limit reached (14 min)."})
        for task in tasks:
            task.cancel()
        if ws.client_state == WebSocketState.CONNECTED:  # stopped, not disconnected: finish what's in flight
            await asyncio.gather(*turns, return_exceptions=True)
            while speaker.speaking or not speaker.queue.empty():
                await asyncio.sleep(0.1)
    except HTTPException as exc:
        await ws.send_json({"type": "error", "error": exc.detail.get("error", str(exc.detail))})
    except Exception as exc:
        try:
            await ws.send_json({"type": "error", "error": server_error(exc, "Live session").detail["error"]})
        except Exception:
            pass
    finally:
        active_agent_sessions -= 1
        speaker.close()
        for task in turns:
            task.cancel()
        try:
            await ws.close()
        except Exception:
            pass
