import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from pydantic import ValidationError

from prompts import EXTRACTION_PROMPT
from schemas import PCR, TranscriptRequest

load_dotenv()

app = FastAPI(title="EMS Voice PCR")


def groq_client() -> Groq:
    load_dotenv()
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail={"error": "GROQ_API_KEY is not set. Add it to backend/.env."},
        )
    return Groq(api_key=api_key)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict[str, str]:
    try:
        audio_bytes = await audio.read()
        transcription = groq_client().audio.transcriptions.create(
            file=("audio.webm", audio_bytes),
            model="whisper-large-v3-turbo",
            response_format="text",
        )
        return {"transcript": str(transcription).strip()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc


@app.post("/api/extract")
async def extract(payload: TranscriptRequest) -> PCR:
    raw_output = ""
    try:
        completion = groq_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": EXTRACTION_PROMPT},
                {"role": "user", "content": payload.transcript},
            ],
            temperature=0.1,
            max_tokens=1024,
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
