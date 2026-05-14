# 108 EMS - Voice PCR

## The Problem

Indian paramedics spend 30-60 minutes on paperwork after ambulance runs, often after the actual care moment has already passed. Voice-first PCR drafting can turn spoken handoffs into structured clinical data while the details are still fresh.

## The Bet

Can an LLM extract clinical data from code-switched Hinglish well enough to save 25+ minutes of paperwork?

## Demo

Loom link: add after recording.

## What's Built

### Core Pipeline
- Voice recording via browser MediaRecorder (WebM/Opus)
- Transcription via Groq Whisper (Hinglish/English)
- Structured extraction via Groq Llama 3.3 70B JSON mode
- Editable Patient Care Report form with 26 clinical fields

### PCR Schema (26 fields across 6 sections)
- **Patient**: name, age, gender
- **Incident**: chief complaint, history, location, scene type, allergies
- **Vitals**: HR, RR, BP, SpO2, GCS, temperature, skin, pain scale
- **Treatment**: airway, IV, oxygen administered, medications (name/dose/route)
- **Disposition**: transport decision, destination, consent, caregiver present
- **Meta**: AI confidence notes, additional notes

### Features
- Amber uncertainty banner when the AI flags something it's unsure about
- Amber left-border highlight on null/unfilled fields
- Audio playback after recording to verify what was said
- Paste transcript mode for text input without recording
- Try an example button with a pre-loaded Hinglish handoff
- Loading skeleton during extraction
- Extraction timing badge showing speed (e.g. 1.8s)
- Export PCR as JSON download
- Saved PCRs sidebar with select, update, and delete
- localStorage persistence across page refreshes
- Mobile responsive layout

## What's Not Built (Prototype Scope)

- No authentication or user accounts
- No database backend (localStorage only)
- No PDF export
- No NEMSIS/ePCR gateway integration
- No multi-language selector

## What's Next

- Store PCR drafts in a real database (Supabase/PostgreSQL)
- Map fields to NEMSIS-compatible ePCR schemas
- Test with real paramedics and noisy ambulance audio
- Integrate with NHA or state ePCR gateway workflows
- PDF generation for hospital handoff

## Stack

React 19 + TypeScript + Tailwind CSS frontend, FastAPI backend, Groq Whisper + Groq Llama 3.3 70B.

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
