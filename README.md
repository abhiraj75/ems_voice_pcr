# EMS Voice PCR

## The Problem

Indian paramedics spend 30-60 minutes on paperwork after ambulance runs, often after the actual care moment has already passed. Voice-first PCR drafting can turn spoken handoffs into structured clinical data while the details are still fresh.

## The Bet

Can an LLM extract clinical data from code-switched Hinglish well enough to save 25+ minutes of paperwork?

## Demo

Loom link: add after recording.

## What's Built

- Single-page React app for recording a patient handoff.
- Browser MediaRecorder audio capture as WebM/Opus.
- FastAPI transcription endpoint using Groq Whisper.
- FastAPI extraction endpoint using Groq Llama 3.3 70B JSON mode.
- Editable Patient Care Report form populated from extracted JSON.
- Amber uncertainty banner when the model flags critical uncertainty.
- Demo-mode save toast and reset.

## What's Faked For This Prototype

- No authentication.
- No database or persistent storage.
- No real submission endpoint.
- No PDF export.
- Hardcoded crew identity.
- Optional visual-only recent PCR sidebar.

## What's Next

- Store PCR drafts in a real database.
- Map fields to NEMSIS-compatible ePCR schemas.
- Test with real paramedics and noisy ambulance audio.
- Integrate with NHA or state ePCR gateway workflows.

## Stack

React + TypeScript + Tailwind CSS frontend, FastAPI backend, Groq Whisper + Groq Llama 3.3 70B.

## Run Locally

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Add GROQ_API_KEY to backend/.env
uvicorn main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.
