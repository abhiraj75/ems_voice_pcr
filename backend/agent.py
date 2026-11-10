"""Voice copilot core: one AgentSession per ambulance run, fed one transcript segment at a time.

Transport-free: handle_segment() returns events; the WebSocket layer (or the REPL / eval) delivers them.
"""
import asyncio
import difflib
import json
import os
import re
import time

from dotenv import load_dotenv
from fastapi import HTTPException
from groq import APIConnectionError, BadRequestError, Groq, RateLimitError
from pydantic import ValidationError

import rules
from languages import (
    ASK_LANGUAGE, ASK_LANGUAGE_ENGLISH, DEFAULT, NOT_SUPPORTED, NOT_SUPPORTED_ENGLISH, PHRASES, pick_language,
)
from prompts import AGENT_PROMPT
from schemas import PCR, Medication
from voice import confirm_text, readback_text

MODEL = "openai/gpt-oss-120b"
# Groq's limits are per model: used only once MODEL's daily token cap (free tier: 200k) is spent.
FALLBACK_MODEL = "openai/gpt-oss-20b"
MAX_TOOL_ROUNDS = 5
HISTORY_TURNS = 6  # STATE carries the report, so little history is needed; tokens are the bottleneck
META_FIELDS = {"evidence", "unsupported", "medications"}
SCALAR_FIELDS = [f for f in PCR.model_fields if f not in META_FIELDS]


def groq_client() -> Groq:
    load_dotenv()
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail={"error": "GROQ_API_KEY is not set. Add it to backend/.env."},
        )
    return Groq(api_key=api_key)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w/.%\s]", " ", text.lower())).strip()


MAX_FUZZY_QUOTE = 200


def verify_quote(quote: str, transcript: str, threshold: float = 0.85) -> bool:
    """True if quote appears in transcript, exactly or as a close fuzzy match (STT/LLM spacing drift)."""
    q, t = _norm(quote), _norm(transcript)
    if not q:
        return False
    if q in t:
        return True
    if len(q) > MAX_FUZZY_QUOTE:  # fuzzy search is O(transcript x quote); evidence quotes should be short
        return False
    n = len(q)
    for i in range(max(1, len(t) - n + 1)):
        window = difflib.SequenceMatcher(None, q, t[i:i + n], autojunk=False)
        if window.quick_ratio() >= threshold and window.ratio() >= threshold:
            return True
    return False


# Agent-led intake: bundled questions cover the essentials; every other field is recorded if mentioned.
# "once" steps are open questions asked a single time; any reply closes them.
STEPS = [
    {"id": "patient", "ask": ["patient_name", "patient_age", "patient_gender"]},
    {"id": "complaint", "ask": ["chief_complaint", "scene_type"]},
    {"id": "vitals", "ask": ["vital_bp", "vital_hr", "vital_spo2", "vital_gcs"]},
    {"id": "allergies", "ask": ["allergies"]},
    {"id": "history", "once": True},
    {"id": "treatment", "any": ["medications", "oxygen_administered", "treatment_iv", "treatment_airway"]},
    {"id": "disposition", "ask": ["destination", "consent_obtained"]},
    {"id": "anything_else", "once": True},
]
# "readback karo" needs no LLM: answering it directly saves a Groq round trip (and tokens).
READBACK_REQUEST = re.compile(r"read\s*-?\s*back|padh\s*(ke|kar)\s*sunao|dohra", re.IGNORECASE)
MAX_ASKS = 3  # a question that keeps getting no answer is dropped, not repeated forever
GREETING = "Namaste, main aapka EMS assistant hoon."
GREETING_ENGLISH = "Hello, I'm your EMS assistant."


def retry_after(message: str) -> float:
    """Seconds from Groq's "try again in 1m2.5s" / "try again in 5.8s"; 2s if absent."""
    m = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", message)
    return int(m.group(1) or 0) * 60 + float(m.group(2)) if m else 2.0


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required}}}


EVIDENCE = {"type": "string", "description": "Shortest exact words from the transcript that state this, verbatim."}
TOOLS = [
    _tool("update_fields", "Record everything a segment states: PCR fields and any medications given, all in this one call.",
          {"updates": {"type": "object", "description": "Field name -> value (any of PCR FIELDS except medications)."},
           "evidence": {"type": "object", "description": "Field name -> shortest exact words from the transcript that state its value, verbatim."},
           "add_medications": {"type": "array", "description": "Leave dose or route as \"\" if not clearly stated; never guess.",
                               "items": {"type": "object", "properties": {"name": {"type": "string"}, "dose": {"type": "string", "description": 'e.g. "300mg"'},
                                         "route": {"type": "string", "description": 'e.g. "oral", "IV"'}, "evidence": EVIDENCE},
                                         "required": ["name", "dose", "route", "evidence"]}}},
          []),
    _tool("remove_medication", "Remove a wrongly recorded medication by its index in the PCR medications list.",
          {"index": {"type": "integer"}}, ["index"]),
    _tool("say", "Speak one short sentence to the medic.",
          {"text": {"type": "string", "description": "In REPLY LANGUAGE."},
           "english": {"type": "string", "description": "The same sentence in English, shown on screen."}}, ["text", "english"]),
    _tool("readback", "Read the vitals and medications aloud for the medic to confirm.", {}, []),
    _tool("finish", "The report is complete and the medic is done.", {}, []),
    _tool("nothing_to_record", "The segment is only filler, with nothing to record or answer.", {}, []),
    _tool("mark_answered", "The medic answered CURRENT QUESTION with none / not done / not known, or asked to skip it.", {}, []),
]


class AgentSession:
    def __init__(self) -> None:
        self.pcr = PCR()
        self.segments: list[str] = []
        self.history: list[dict] = []
        self.spoken_issues: set[str] = set()
        self.lock = asyncio.Lock()
        self.pending: list[str] = []
        self.rate_wait = 0.0  # seconds the last turn spent waiting on Groq's rate limit
        self.model = MODEL
        self.skipped: set[str] = set()
        self.asks: dict[str, int] = {}
        self.current: dict | None = None
        self.current_question = ""
        self.question_display = ""
        self.closed = False
        self.language: str | None = None  # chosen at the start; None until then
        self.language_asks = 0

    @property
    def lang(self) -> str:
        return self.language or DEFAULT

    @property
    def transcript(self) -> str:
        return " ".join(self.segments)

    def _set_evidence(self, field: str, quote: str) -> None:
        if verify_quote(quote, self.transcript):
            self.pcr.evidence[field] = quote
            if field in self.pcr.unsupported:
                self.pcr.unsupported.remove(field)
        else:
            self.pcr.evidence.pop(field, None)
            if field not in self.pcr.unsupported:
                self.pcr.unsupported.append(field)

    def run_tool(self, name: str, args: dict, events: list[dict]) -> str:
        """Apply one tool call; returns the result string fed back to the model."""
        if name == "update_fields":
            updates = args.get("updates") or {}
            unknown = [k for k in updates if k not in SCALAR_FIELDS]
            if unknown:
                return f"error: unknown fields {unknown}. Allowed: {SCALAR_FIELDS}"
            try:
                pcr = PCR(**{**self.pcr.model_dump(), **updates})
            except ValidationError as exc:
                return f"error: {exc.errors()[0]['loc']} {exc.errors()[0]['msg']}. Nothing was changed."
            self.pcr = pcr
            evidence = args.get("evidence") or {}
            for field in updates:
                self._set_evidence(field, evidence.get(field, "") if isinstance(evidence, dict) else str(evidence))
            for med in args.get("add_medications") or []:
                if isinstance(med, dict):
                    self.run_tool("add_medication", med, events)
            return "ok"
        if name == "add_medication":
            med = Medication(name=str(args.get("name") or ""), dose=str(args.get("dose") or ""), route=str(args.get("route") or ""))
            self.pcr.medications.append(med)
            self._set_evidence(f"medications.{len(self.pcr.medications) - 1}", args.get("evidence", ""))
            return "ok"
        if name == "remove_medication":
            i = args.get("index")
            if not isinstance(i, int) or not 0 <= i < len(self.pcr.medications):
                return f"error: no medication at index {i}"
            self.pcr.medications.pop(i)
            # Re-key medication evidence so indexes stay aligned.
            med_keys = {k: v for k, v in self.pcr.evidence.items() if k.startswith("medications.")}
            for k in med_keys:
                del self.pcr.evidence[k]
            for k, v in med_keys.items():
                j = int(k.split(".")[1])
                if j != i:
                    self.pcr.evidence[f"medications.{j - (j > i)}"] = v
            self.pcr.unsupported = [u for u in self.pcr.unsupported if not u.startswith("medications.")]
            return "ok"
        if name == "say":
            events.append({"type": "say", "source": "agent", "text": str(args.get("text", ""))[:300],
                           "display": str(args.get("english") or args.get("text", ""))[:300]})
            return "ok"
        if name == "readback":
            events.append({"type": "say", "source": "readback", "text": readback_text(self.pcr, self.lang),
                           "display": readback_text(self.pcr, "english")})
            return "readback is being spoken; do not repeat it"
        if name == "nothing_to_record":
            return "ok"
        if name == "mark_answered":
            if self.current:
                self.skipped.add(self.current["id"])
            return "ok"
        if name == "finish":
            events.append({"type": "done"})
            return "ok"
        return f"error: unknown tool {name}"

    def _missing(self, step: dict) -> list[str]:
        """Fields still needed for a step; empty when the step is done."""
        if step["id"] in self.skipped:
            return []
        if step.get("once"):
            return [step["id"]]
        if "any" in step:
            return [] if any(getattr(self.pcr, f) not in (None, "", []) for f in step["any"]) else step["any"]
        if step["id"] == "disposition" and self.pcr.transport_decision in ("refused", "deceased"):
            return []
        return [field for field in step["ask"] if getattr(self.pcr, field) is None]

    def _render_question(self, step: dict, missing: list[str], lang: str) -> str:
        p = PHRASES[lang]
        if "any" in step or step.get("once"):
            return p[step["id"]]
        labels = [p["ask_labels"][f] for f in missing]
        joined = f"{', '.join(labels[:-1])} {p['and']} {labels[-1]}" if len(labels) > 1 else labels[0]
        question = p["ask"].format(joined)
        return question[0].upper() + question[1:]

    def _closing(self, lang: str) -> str:
        p = PHRASES[lang]
        gaps = " ".join(i["say"] for i in rules.check(self.pcr, lang) if i["severity"] == "gap")
        return " ".join(part for part in (p["done"], gaps, p["closing"]) if part)

    def next_question(self) -> str | None:
        """The next thing to ask, built from what is still empty; a closing line once, then None.
        Also sets question_display, the English wording shown on screen."""
        self.current, self.current_question, self.question_display = None, "", ""
        for step in STEPS:
            missing = self._missing(step)
            if missing and self.asks.get(step["id"], 0) < MAX_ASKS:
                self.asks[step["id"]] = self.asks.get(step["id"], 0) + 1
                self.current = step
                self.current_question = self._render_question(step, missing, self.lang)
                self.question_display = self._render_question(step, missing, "english")
                return self.current_question
        if self.closed:
            return None
        self.closed = True
        self.question_display = self._closing("english")
        return self._closing(self.lang)

    def opening(self) -> str:
        return f"{GREETING} {ASK_LANGUAGE}"

    def opening_display(self) -> str:
        return f"{GREETING_ENGLISH} {ASK_LANGUAGE_ENGLISH}"

    def _choose_language(self, text: str) -> list[dict] | None:
        """Handle the answer to the language question without an LLM call; None if no language was named."""
        choice = pick_language(text)
        if choice is None:
            return None
        if choice not in PHRASES:
            return [{"type": "say", "source": "question", "text": NOT_SUPPORTED.format(language=choice),
                     "display": NOT_SUPPORTED_ENGLISH.format(language=choice)}]
        self.language = choice
        spoken = f"{PHRASES[choice]['chosen']} {self.next_question()}"
        return [{"type": "say", "source": "question", "text": spoken,
                 "display": f"{PHRASES[choice]['chosen_english']} {self.question_display}"}]

    def alerts(self, issues: list[dict]) -> list[dict]:
        """New critical issues are spoken once, from fixed templates (never LLM text)."""
        events = []
        english = {i["id"]: i["say"] for i in rules.check(self.pcr, "english")}
        for issue in issues:
            if issue["severity"] == "critical" and issue["id"] not in self.spoken_issues:
                self.spoken_issues.add(issue["id"])
                events.append({"type": "say", "source": "alert", "text": issue["say"],
                               "display": english.get(issue["id"], issue["say"])})
        return events

    def _state(self) -> str:
        pcr = {k: v for k, v in self.pcr.model_dump(exclude={"evidence", "unsupported"}).items() if v not in (None, [])}
        issues = [{k: i[k] for k in ("severity", "message")} for i in rules.check(self.pcr)]
        return ("STATE\nPCR: " + json.dumps(pcr) + "\nOPEN ISSUES: " + json.dumps(issues)
                + "\nCURRENT QUESTION: " + (self.current_question or "none")
                + "\nREPLY LANGUAGE: " + PHRASES[self.lang]["name"])

    async def _complete(self, client: Groq, messages: list[dict], tool_choice: str = "auto"):
        """Groq call; on a rate limit, wait as long as Groq asks and fold in segments that arrived meanwhile.
        ponytail: free tier is 8k tokens/min (~2 segments/min); Groq Dev tier lifts it with no code change."""
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                return await asyncio.to_thread(
                    client.chat.completions.create,
                    model=self.model, messages=messages, tools=TOOLS, tool_choice=tool_choice,
                    temperature=0.1, max_tokens=1024, reasoning_effort="low",
                )
            except RateLimitError as exc:
                if "tokens per day" in str(exc) and self.model != FALLBACK_MODEL:
                    self.model = FALLBACK_MODEL
                    continue
                wait = min(retry_after(str(exc)), 20) + 0.2
                self.rate_wait += wait
                await asyncio.sleep(wait)
                if self.pending and messages[-1]["role"] == "user":
                    extra = " ".join(self.pending)
                    self.pending.clear()
                    self.segments.append(extra)
                    messages[-1]["content"] += " " + extra
            except BadRequestError:
                # gpt-oss sometimes writes a malformed call, and "required" makes Groq reject the whole response.
                if tool_choice != "required":
                    raise HTTPException(status_code=502, detail={"error": "The AI couldn't process that. Please say it again."})
                tool_choice = "auto"
            except APIConnectionError:  # includes timeouts; transient drops are common
                await asyncio.sleep(0.5)
        raise HTTPException(status_code=429, detail={"error": "Groq is rate limiting or unreachable: try again in a minute."})

    async def handle_segment(self, text: str) -> list[dict]:
        """Process a speech segment. Segments queued behind a running turn are merged into one turn;
        the callers whose text was merged get an empty event list."""
        self.pending.append(text)
        async with self.lock:
            if not self.pending:
                return []
            text = " ".join(self.pending)
            self.pending.clear()
            if self.language is None:
                events = self._choose_language(text)
                if events is not None:
                    return events
            self.segments.append(text)
            if READBACK_REQUEST.search(text) and len(text.split()) <= 6:
                self.history += [{"role": "user", "content": text}, {"role": "assistant", "content": "(readback)"}]
                return [{"type": "say", "source": "readback", "text": readback_text(self.pcr, self.lang),
                         "display": readback_text(self.pcr, "english")}]
            events: list[dict] = []
            self.rate_wait = 0.0
            before = self.pcr.model_copy(deep=True)
            skipped_before = set(self.skipped)
            user_msg = {"role": "user", "content": text}
            messages = [
                {"role": "system", "content": AGENT_PROMPT},
                {"role": "system", "content": self._state()},
                *self.history[-HISTORY_TURNS:],
                user_msg,
            ]
            client = groq_client().with_options(max_retries=0, timeout=30)
            # One call per turn (8k tokens/min on the free tier); another round only to fix a failed tool call.
            # The first round must call a tool, so a segment is never silently skipped.
            for round_ in range(MAX_TOOL_ROUNDS):
                msg = (await self._complete(client, messages, "required" if round_ == 0 else "auto")).choices[0].message
                if not msg.tool_calls:
                    break
                failed = False
                messages.append({"role": "assistant", "content": msg.content or "",
                                 "tool_calls": [c.model_dump() for c in msg.tool_calls]})
                for call in msg.tool_calls:
                    try:
                        result = self.run_tool(call.function.name, json.loads(call.function.arguments or "{}"), events)
                    except json.JSONDecodeError:
                        result = "error: arguments were not valid JSON"
                    failed |= result.startswith("error")
                    messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
                if not failed:
                    break

            said = [e["text"] for e in events if e["type"] == "say" and e["source"] == "agent"]
            self.history += [user_msg, {"role": "assistant", "content": " ".join(said) or "(silent)"}]

            if self.current and self.current.get("once"):  # any reply closes an open question
                self.skipped.add(self.current["id"])
            # Filler: the turn changed nothing and said nothing, so don't nag with the question again.
            quiet = not events and self.pcr == before and self.skipped == skipped_before
            issues = rules.check(self.pcr, self.lang)
            confirm = confirm_text(before, self.pcr, self.lang)
            if confirm:  # spoken before anything the agent says, so the medic can check each step
                events.insert(0, {"type": "say", "source": "confirm", "text": confirm,
                                  "display": confirm_text(before, self.pcr, "english")})
            if self.pcr.model_dump_json() != before.model_dump_json():
                events.insert(0, {"type": "pcr", "pcr": self.pcr.model_dump()})
            events.append({"type": "issues", "issues": issues})
            events += self.alerts(issues)
            if self.language is None:
                # No language named. Ask once more unless the medic has clearly started the report.
                if self.pcr == before and self.language_asks == 0:
                    self.language_asks += 1
                    events.append({"type": "say", "source": "question", "text": ASK_LANGUAGE, "display": ASK_LANGUAGE_ENGLISH})
                    return events
                self.language = DEFAULT
            # Lead the conversation, except after filler, a readback, or the end of the report.
            if not quiet and not any(e["type"] == "done" or e.get("source") == "readback" for e in events):
                question = self.next_question()
                if question:
                    events.append({"type": "say", "source": "question", "text": question, "display": self.question_display})
            return events


async def _repl() -> None:
    session = AgentSession()
    print("Type medic segments (Ctrl-D to quit).")
    while True:
        try:
            text = await asyncio.to_thread(input, "medic> ")
        except EOFError:
            break
        for event in await session.handle_segment(text):
            if event["type"] == "pcr":
                filled = {k: v for k, v in event["pcr"].items() if v not in (None, [], {})}
                print("  pcr:", json.dumps(filled, ensure_ascii=False))
            elif event["type"] == "issues":
                print("  issues:", [f"{i['severity']}: {i['message']}" for i in event["issues"]])
            else:
                print(f"  {event['type']}:", event.get("source", ""), event.get("text", ""))


if __name__ == "__main__":
    asyncio.run(_repl())
