# 108 Voice PCR

A voice copilot for India's 108 ambulances. The paramedic talks in Hindi or English, and the Patient Care Report (PCR) fills itself. A live agent asks for each detail, reads back what it recorded, and flags safety risks such as a drug the patient is allergic to.

Built on Gnani AI's **Prisma v3.0** (speech-to-text) and **Timbre v3.0** (text-to-speech).

> Prototype. Tested only on synthetic patients. The safety checks are illustrative, not clinical guidance.

## The problem

Paramedics in India spend 30 to 60 minutes on paperwork after a run, usually from memory once the patient has been handed over. Details get lost, and the report is written when it is least useful. If the report could be filled by voice during the run, it would be more complete, it would be ready at handover, and it could catch mistakes while they can still be fixed.

## Try it

- **App**: [ems-voice-pcr.vercel.app](https://ems-voice-pcr.vercel.app)
- **One-page pitch**: [ems-voice-pcr.vercel.app/pitch](https://ems-voice-pcr.vercel.app/pitch/)
- **API**: [ems-voice-pcr.onrender.com](https://ems-voice-pcr.onrender.com)
- **Demo video (live agent, in Hindi)**: [Google Drive](https://drive.google.com/file/d/1XA8E2EQvbcwtzX_8U4FckM3M5vdC-80p/view?usp=sharing)

The backend runs on Render's free tier, which sleeps after 15 minutes idle; the first request after that takes about 30 seconds. Use Chrome or Edge and allow the microphone.

## Two ways to fill a report

A chooser on first visit explains both. Switch any time from the top bar.

### Live agent

A two-way voice conversation. The agent leads the interview, so the medic never has to remember what's missing.

1. It greets the medic and asks which language to use. English and everyday spoken Hindi (Roman script, with the English terms medics actually use) are supported; other languages are named and politely declined.
2. It asks one bundled question at a time, only for what is still empty:
   patient (name, age, gender), what happened and where, vitals (BP, pulse, SpO2, GCS), allergies, history, treatment given, destination and consent, and finally "anything else?".
   An unanswered question is asked at most three times. The handover question is skipped if the patient refused transport or is deceased.
3. After every answer it reads back exactly what it wrote ("Noted: B P 110 over 70, pulse 118"), built from the form, not from model text.
4. When the questions are done it names any open gaps, then offers a readback.

The medic can also talk to it:

| Medic says | Agent does |
|---|---|
| Answers out of order or gives many details at once | Records all of them |
| "BP 350 over 90" (impossible value) | Doesn't record it; says what it heard and asks again |
| "Aspirin galti se likha, hata do" | Removes the medication |
| "SpO2 nahi liya, skip karo" | Moves on; the gap is named at the end |
| "SpO2 kitna likha hai?" / "kya bacha hai?" | Answers from the report |
| "GCS kya hota hai?" | Explains the term in one sentence |
| "Mujhe kaunsi dawai deni chahiye?" | Refuses; follow protocol or medical control |
| Something unrelated | Says it can only help with this report |
| "Readback karo" | Reads vitals and medications back, answered instantly without an LLM call |
| Details that fit no field ("helmet nahi pehna tha") | Saves them under **Other details**, shown in its own card |

**Push-to-talk.** Hold the bar to talk and release to send, or tap once to start and tap again to send. Audio leaves the browser only while talking, so background noise and the agent's own voice never reach speech recognition. Pressing while the agent speaks cuts it off. A text box is there for scenes too noisy to speak in.

### Record mode

Speak the whole handoff in one go. The audio is transcribed by Prisma v3.0 and turned into a structured report by one LLM call, usually in about 2 seconds. The medic checks the form, can hear vitals and medications read back by Timbre v3.0, and confirms them. You can also paste a transcript or try a built-in Hinglish example.

## Safety checks

Deterministic rules in [`backend/rules.py`](backend/rules.py) run on the form after every change. The model never writes alert text: critical alerts are spoken once from fixed templates, so they always match what is recorded.

| Severity | Check | How it's shown |
|---|---|---|
| Critical | Medication clashes with a recorded allergy (penicillins, NSAIDs/aspirin, sulfa, or the named drug) | Spoken and shown |
| Critical | GCS 8 or below with no airway management recorded | Spoken and shown |
| Critical | Implausible vital, almost certainly a mishearing (e.g. pulse 900, BP 350/90, SpO2 above 100) | Spoken and shown |
| Warning | Shock index (pulse / systolic BP) above 1 | Shown |
| Warning | SpO2 below 94 with no oxygen recorded | Shown |
| Warning | Dose outside the usual single-dose range (aspirin, tramadol, ondansetron, diazepam, adrenaline) | Shown |
| Gap | BP, pulse, SpO2 or GCS missing; consent missing when transporting | Shown, and named at the end |

## Every value is traceable

Each field the agent sets carries the exact words it came from, checked against the transcript (exact match, or a fuzzy match of 0.85 or better). Hover a field to highlight those words in the conversation. A value whose quote can't be found gets a red **no source** badge. Editing a field by hand clears its evidence and syncs the change back to the agent.

## The report

26 fields in six sections, all editable:

- **Patient**: name, age, gender
- **Incident**: chief complaint, history, location, scene type, allergies
- **Vitals**: HR, RR, BP, SpO2, GCS, temperature, skin, pain score
- **Treatment**: airway, IV, oxygen, medications (name, dose, route)
- **Disposition**: transport decision, destination, consent, caregiver present
- **Other details**, plus any uncertainty the model flagged

Empty fields are marked in amber. Reports can be saved (they stay in the browser's local storage, across refreshes), reopened from the sidebar, updated, deleted, exported as JSON, or printed / saved as a one-page PDF for handover.

## Evaluation

[`backend/eval`](backend/eval) replays 12 synthetic Hinglish handoffs through both modes and scores every field. The cases cover chest pain, trauma with an allergy clash, stroke, a paediatric seizure, cardiac arrest, asthma, hypoglycaemia and an overdose, plus a mid-sentence BP correction, numbers spoken in Hindi, a refused transport, and a sparse handoff that tempts the model to invent values.

| Mode | Field accuracy | Wrong / missed / invented | Expected critical alerts raised | Evidence verified |
|---|---|---|---|---|
| Record (single-shot) | 128/132 (97%) | 2 / 2 / 0 | 4/4 | n/a |
| Live agent (segment by segment) | 123/134 (92%) | 0 / 10 / 1 | 4/4 | 94/97 |

Measured on 23 Oct 2026, before the latest agent changes (history and closing questions, readback shortcut). Six of the agent's ten misses were transport decision or caregiver, which it doesn't ask about; its one invented value was an SpO2. Re-run with `python -m eval.run`.

## How it works

```
Browser                                  FastAPI                                  Services
mic ─ 16 kHz PCM while held ─ WebSocket ▶ /ws/agent
                                          on release: whole press as WAV ───────▶ Gnani Prisma v3.0
                                          AgentSession.handle_segment(text)
                                            ├─ one tool call per turn ───────────▶ Groq gpt-oss-120b
                                            ├─ validate against the PCR schema
                                            ├─ verify evidence quotes
                                            ├─ rules.check(pcr)
                                            └─ next question (fixed wording)
◀── events: transcript, pcr, issues, agent text
◀── 24 kHz speech ─────────────────────── one utterance per turn ───────────────▶ Gnani Timbre v3.0
```

- **Tools**: `update_fields` (fields and medications in one call), `remove_medication`, `mark_answered`, `say`, `readback`, `finish`, `nothing_to_record`. A tool call that fails validation is returned to the model and nothing is written.
- **Fixed wording for anything safety-relevant**: questions, "Noted" confirmations, alerts and readback are built from the form. The model only records data and handles side questions. All spoken wording lives in [`backend/languages.py`](backend/languages.py).
- **Rate limits**: one LLM call per turn, segments that arrive mid-turn are merged, Groq's retry hints are honoured, and if the 120B model's daily token cap is spent the agent falls back to `gpt-oss-20b`.
- **Dropped connections**: Render's free tier cuts WebSockets mid-session, so the browser pings every 3 seconds and reconnects with its session id; the server keeps the report and conversation for 5 minutes and re-asks the current question.
- **Guardrails**: 30-minute session cap, at most 3 concurrent sessions, WebSocket origin check, CORS allowlist.
- **Privacy**: spoken words and transcripts are never logged. Audio goes to Gnani and text to Groq for processing; saved reports stay in the browser.

## Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Vite. Mic capture with an inline AudioWorklet; no extra audio libraries.
- **Backend**: FastAPI (REST and WebSocket), Pydantic, httpx, websockets.
- **Speech**: Gnani Prisma v3.0 batch STT (`en-IN`, EMS key terms, topic hint); Gnani Timbre v3.0 REST and realtime TTS (voice Lakshmi, `hi-en` and `en-IN`).
- **LLM**: Groq `openai/gpt-oss-120b` for extraction and the agent, `gpt-oss-20b` as fallback.

## Run locally

Requirements: Python 3.11+, Node 20+, a Gnani API key and a Groq API key.

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # add GNANI_API_KEY and GROQ_API_KEY
python test_main.py        # offline self-checks
uvicorn main:app --reload --port 8000
```

Optional:

```bash
python -m agent            # talk to the agent by typing, no audio
python -m eval.run         # score both modes on eval/cases.jsonl (uses Groq tokens)
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

| Variable | Where | Purpose |
|---|---|---|
| `GNANI_API_KEY` | backend | Prisma STT and Timbre TTS |
| `GROQ_API_KEY` | backend | Extraction and the agent |
| `CORS_ORIGINS` | backend, optional | Comma-separated allowed origins; defaults to the Vercel app and localhost |
| `VITE_API_URL` | frontend, optional | Backend URL; defaults to `http://localhost:8000` |

## What's next

- **Hospital pre-arrival screen**: the receiving team watches the report fill in during the run and prepares before the patient arrives.
- **Accounts and a database**: login, and hosted storage with encryption and retention rules suited to health data under India's DPDP Act. Today reports live only in the browser.
- **Automate the rest**: vitals pulled from the monitor, time and location from the 108 dispatch call, and the finished report sent to state or NHA ePCR systems.
- **OPD mode**: the same agent takes a patient's complaint, history and vitals before they see the doctor.
- **More languages** beyond English and Hindi; the wording table is ready for reviewed additions.
- **Real-world testing**: an eval with siren noise mixed into the audio, a pilot with working 108 paramedics, and a clinician review of the rules.
