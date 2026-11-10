from main import readback_text
from schemas import PCR, Medication

pcr = PCR(vital_bp="160/100", vital_hr=110, vital_spo2=96, vital_temp=99.0,
          medications=[Medication(name="aspirin", dose="300mg", route="oral")])
text = readback_text(pcr)
assert "B P 160 over 100." in text, text
assert "Pulse 110." in text and "Temperature 99." in text, text
assert "Respiratory rate" not in text, text  # null fields skipped
assert "aspirin 300 milligram oral" in text, text
assert readback_text(PCR()) == "No vitals or medications recorded."


# Caps reject before any paid Gnani call is made.
from fastapi.testclient import TestClient
from main import MAX_CHUNK_BYTES, MAX_CHUNKS, app

client = TestClient(app)
files = [("audio", (f"{i}.wav", b"x", "audio/wav")) for i in range(MAX_CHUNKS + 1)]
assert client.post("/api/transcribe", files=files).status_code == 413
big = [("audio", ("big.wav", b"x" * (MAX_CHUNK_BYTES + 1), "audio/wav"))]
assert client.post("/api/transcribe", files=big).status_code == 413
assert client.post("/api/readback", json={"medications": [{"name": "a" * 2000, "dose": "1mg", "route": "oral"}]}).status_code == 413


# Protocol rules fire, and stay quiet when they should.
import rules
from agent import AgentSession, verify_quote

ids = lambda p: {i["id"] for i in rules.check(p)}
assert "allergy:amoxicillin" in ids(PCR(allergies="penicillin", medications=[Medication(name="amoxicillin", dose="500mg", route="oral")]))
assert "allergy:aspirin" in ids(PCR(allergies="NSAIDs", medications=[Medication(name="aspirin", dose="300mg", route="oral")]))
assert not any(i.startswith("allergy") for i in ids(PCR(allergies="no known allergies", medications=[Medication(name="aspirin", dose="300mg", route="oral")])))
assert "gcs_airway" in ids(PCR(vital_gcs=7)) and "gcs_airway" not in ids(PCR(vital_gcs=7, treatment_airway="OPA"))
assert "shock_index" in ids(PCR(vital_bp="90/60", vital_hr=118)) and "shock_index" not in ids(PCR(vital_bp="120/80", vital_hr=90))
assert "spo2_no_o2" in ids(PCR(vital_spo2=89)) and "spo2_no_o2" not in ids(PCR(vital_spo2=89, oxygen_administered="6L mask"))
assert "dose:aspirin" in ids(PCR(medications=[Medication(name="aspirin", dose="3000mg", route="oral")]))
assert "dose:aspirin" not in ids(PCR(medications=[Medication(name="aspirin", dose="300 mg", route="oral")]))
# Implausible vitals: flagged (critical, so spoken) and never feed the shock index.
bad = ids(PCR(vital_bp="10/70", vital_hr=118))
assert "implausible:vital_bp:10/70" in bad and "shock_index" not in bad, bad
assert "implausible:vital_spo2:295" in ids(PCR(vital_spo2=295))
assert not any(i.startswith("implausible") for i in ids(PCR(vital_bp="110/70", vital_hr=118, vital_spo2=95)))
full = PCR(vital_bp="120/80", vital_hr=80, vital_spo2=98, vital_gcs=15)
assert not any(i.startswith("gap:") for i in ids(full))
assert "gap:consent" in ids(PCR(transport_decision="transport"))

# Provenance: exact, fuzzy (spacing/punctuation drift), and fabricated quotes.
t = "BP liya 110 over 70, pulse 118. Penicillin se allergy hai."
assert verify_quote("pulse 118", t) and verify_quote("BP liya 110 over  70", t)
assert verify_quote("penicilin se allergy hai", t)
assert not verify_quote("SpO2 95 percent", t) and not verify_quote("", t)

s = AgentSession()
s.segments = [t]
ev: list = []
assert s.run_tool("update_fields", {"updates": {"vital_hr": 118}, "evidence": {"vital_hr": "pulse 118"}}, ev) == "ok"
assert s.pcr.vital_hr == 118 and s.pcr.evidence["vital_hr"] == "pulse 118"
s.run_tool("update_fields", {"updates": {"vital_spo2": 95}, "evidence": {"vital_spo2": "SpO2 95 percent"}}, ev)
assert "vital_spo2" in s.pcr.unsupported and "vital_spo2" not in s.pcr.evidence
# Invalid patches change nothing.
assert s.run_tool("update_fields", {"updates": {"vital_gcs": 40}, "evidence": "x"}, ev).startswith("error")
assert s.run_tool("update_fields", {"updates": {"bogus": 1}, "evidence": "x"}, ev).startswith("error")
assert s.pcr.vital_gcs is None and s.pcr.vital_hr == 118
# Medication evidence re-keys on removal.
s.run_tool("add_medication", {"name": "a", "dose": "1mg", "route": "oral", "evidence": "pulse 118"}, ev)
s.run_tool("add_medication", {"name": "b", "dose": "1mg", "route": "oral", "evidence": "Penicillin se allergy"}, ev)
s.run_tool("remove_medication", {"index": 0}, ev)
assert [m.name for m in s.pcr.medications] == ["b"] and s.pcr.evidence["medications.0"] == "Penicillin se allergy"
assert s.run_tool("readback", {}, ev) and ev[-1]["source"] == "readback"

# A critical alert is spoken once, from its template.
issues = rules.check(PCR(vital_gcs=6))
assert [e["source"] for e in s.alerts(issues)] == ["alert"] and s.alerts(issues) == []
print("ok")

# Eval scorer: numbers, BP, nulls, free text, medications with dose/route normalisation.
from eval.run import score_case

case = {"expected": {"vital_hr": 118, "vital_bp": "110/70", "vital_spo2": None, "chief_complaint": "chest pain",
                     "medications": [{"name": "aspirin", "dose": "325mg", "route": "oral"}]}}
got = PCR(vital_hr=118, vital_bp="110 / 70", vital_spo2=95, chief_complaint="Chest pain since 3 hours",
          medications=[Medication(name="Aspirin", dose="325 milligram", route="PO"), Medication(name="tramadol", dose="50mg", route="IV")])
assert score_case(case, got) == {"vital_hr": "correct", "vital_bp": "correct", "vital_spo2": "hallucinated",
                                 "chief_complaint": "correct", "medications.aspirin": "correct",
                                 "medications.aspirin.dose": "correct", "medications.aspirin.route": "correct",
                                 "medications.tramadol": "hallucinated"}, score_case(case, got)
assert score_case({"expected": {"vital_hr": 118}}, PCR())["vital_hr"] == "missed"
print("eval scorer ok")

from agent import retry_after
assert retry_after("Please try again in 5.8875s.") == 5.8875 and retry_after("try again in 1m2.5s") == 62.5 and retry_after("x") == 2.0
print("retry ok")

# Per-turn confirmation names exactly what changed, from the form, in order.
from voice import confirm_text
a = PCR(patient_name="Suresh Yadav")
b = PCR(patient_name="Suresh Yadav", patient_age=34, vital_bp="110/70", vital_temp=99.0, consent_obtained=True,
        history="long story", medications=[Medication(name="aspirin", dose="300mg", route="oral")])
assert confirm_text(a, b) == ("Noted: age 34, B P 110 over 70, temperature 99, consent haan, history noted, "
                              "medication aspirin 300 milligram oral."), confirm_text(a, b)
assert confirm_text(b, b) is None
assert confirm_text(b, PCR(patient_name="Suresh Yadav")).startswith("Noted: age cleared")
assert "removed aspirin 300 milligram oral" in confirm_text(b, PCR())
assert readback_text(b) == "Readback. B P 110 over 70. Temperature 99. Medications: aspirin 300 milligram oral. Please confirm."
print("confirm ok")

# Agent-led intake: asks only what's missing, skips on request, respects refusal, closes once.
s = AgentSession()
assert s.opening() == "Namaste, main aapka EMS assistant hoon. Aap kis language mein baat karna chahenge?"
assert s.next_question() == "Patient ka naam, age aur gender batayein."
s.pcr = PCR(patient_name="A", patient_age=30, patient_gender="male", chief_complaint="x", scene_type="road", vital_bp="120/80", vital_hr=80)
assert s.next_question() == "SpO2 aur GCS batayein."
assert s.run_tool("mark_answered", {}, []) == "ok" and s.next_question() == "Koi allergy batayein."
s.pcr.allergies = "no known allergies"
assert s.next_question().startswith("Patient ki history batayein")
s.skipped.add("history")  # handle_segment closes a "once" question after any reply
assert s.next_question() == "Koi dawai, oxygen ya IV diya?"
s.pcr.treatment_iv = "NS"
assert s.next_question() == "Kahan le ja rahe hain aur consent mila ya nahi batayein."
s.pcr.transport_decision = "refused"
assert s.next_question() == "Aur kuch add karna hai?"
s.skipped.add("anything_else")
closing = s.next_question()
assert closing.startswith("Report ho gaya.") and "SpO2 abhi record nahi hua." in closing, closing
assert s.next_question() is None
s = AgentSession()
assert [s.next_question() for _ in range(3)] == ["Patient ka naam, age aur gender batayein."] * 3
assert s.next_question().startswith("Kya hua hai")  # capped, moves on
print("intake ok")

# One update_fields call records fields and medications together; null dose/route don't crash.
s = AgentSession()
s.segments = ["Aspirin 300 milligram oral diya, pulse 80"]
assert s.run_tool("update_fields", {"updates": {"vital_hr": 80}, "evidence": {"vital_hr": "pulse 80"},
                                    "add_medications": [{"name": "aspirin", "dose": "300mg", "route": "oral", "evidence": "Aspirin 300 milligram oral"},
                                                        {"name": "x", "dose": None, "route": None, "evidence": "nope"}]}, []) == "ok"
assert s.pcr.vital_hr == 80 and [m.dose for m in s.pcr.medications] == ["300mg", ""]
assert s.pcr.evidence["medications.0"] == "Aspirin 300 milligram oral" and "medications.1" in s.pcr.unsupported
print("single call ok")

# Language choice: no LLM, supported ones continue, others are refused, reads out in that language.
from languages import PHRASES, pick_language
assert set(PHRASES) == {"english", "hindi"}
assert pick_language("English please") == "english" and pick_language("Hindi mein") == "hindi"
assert pick_language("Hinglish chalega") == "hindi" and pick_language("hindi english mix") == "hindi"
assert pick_language("Nepali") == "Nepali" and pick_language("Tamil mein baat karo") == "Tamil" and pick_language("Suresh Yadav, 34 saal") is None
assert PHRASES["english"].keys() == PHRASES["hindi"].keys()  # both languages have every line
assert PHRASES["english"]["rules"].keys() == PHRASES["hindi"]["rules"].keys()
s = AgentSession()
assert "Tamil abhi supported nahi" in s._choose_language("Tamil")[0]["text"] and s.language is None
assert s._choose_language("Suresh 34 saal") is None
e = s._choose_language("English please")[0]["text"]
assert e == "Okay, let's continue in English. Please tell me the patient's name, age and gender.", e
h = AgentSession()
assert h._choose_language("Hindi")[0]["text"] == "Theek hai, Hindi mein baat karte hain. Patient ka naam, age aur gender batayein."
both = PCR(vital_bp="110/70", consent_obtained=True, medications=[Medication(name="aspirin", dose="300mg", route="oral")])
assert confirm_text(PCR(), both, "english") == "Noted: B P 110 over 70, consent yes, medication aspirin 300 milligram oral."
assert confirm_text(PCR(), both, "hindi") == "Noted: B P 110 over 70, consent haan, medication aspirin 300 milligram oral."
assert rules.check(PCR(vital_gcs=6), "english")[0]["say"] == "Alert. GCS is 6 and no airway management is recorded."
print("language ok")

# Spoken in the chosen language, written in English.
s = AgentSession()
assert s.opening_display() == "Hello, I'm your EMS assistant. Which language would you like to speak in?"
e = s._choose_language("Tamil")[0]
assert "abhi supported nahi" in e["text"] and e["display"].startswith("Sorry, Tamil isn't supported yet.")
e = s._choose_language("Hindi")[0]
assert e["text"] == "Theek hai, Hindi mein baat karte hain. Patient ka naam, age aur gender batayein."
assert e["display"] == "Okay, let's continue in Hindi. Please tell me the patient's name, age and gender.", e["display"]
s.segments = ["x"]
ev: list = []
s.run_tool("say", {"text": "Sirf report mein madad kar sakta hoon.", "english": "I can only help with this report."}, ev)
assert ev[0]["text"].startswith("Sirf") and ev[0]["display"] == "I can only help with this report."
s.run_tool("say", {"text": "Theek hai."}, ev)
assert ev[1]["display"] == "Theek hai."
s.pcr = PCR(vital_gcs=6)
a = s.alerts(rules.check(s.pcr, "hindi"))[0]
assert a["text"].startswith("Alert. GCS 6 hai") and a["display"] == "Alert. GCS is 6 and no airway management is recorded."
print("display ok")

# Groq failures: a malformed "required" call retries as auto; a spent daily cap switches model.
import asyncio
from types import SimpleNamespace as NS

import httpx
from groq import BadRequestError, RateLimitError
from agent import FALLBACK_MODEL, MODEL

req = httpx.Request("POST", "http://x")
def client(*outcomes):
    seen = []
    def create(**kw):
        seen.append(kw)
        o = outcomes[len(seen) - 1]
        if isinstance(o, Exception):
            raise o
        return o
    return NS(chat=NS(completions=NS(create=create))), seen
ok = NS(choices=[])
bad = BadRequestError("tool_use_failed", response=httpx.Response(400, request=req), body=None)
c, seen = client(bad, ok)
assert asyncio.run(AgentSession()._complete(c, [{"role": "user", "content": "x"}], "required")) is ok
assert [k["tool_choice"] for k in seen] == ["required", "auto"]
day = RateLimitError("on tokens per day (TPD): Limit 200000", response=httpx.Response(429, request=req), body=None)
s = AgentSession()
c, seen = client(day, ok)
assert asyncio.run(s._complete(c, [{"role": "user", "content": "x"}])) is ok
assert [k["model"] for k in seen] == [MODEL, FALLBACK_MODEL] and s.model == FALLBACK_MODEL and s.rate_wait == 0
print("groq failures ok")

# A press of browser PCM becomes a valid WAV for Prisma.
import io, wave as _wave
from voice import pcm_to_wav
w = _wave.open(io.BytesIO(pcm_to_wav(b"\x01\x00" * 16000)))
assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 16000, 16000)
print("press wav ok")

# "readback karo" is answered without an LLM call; a long sentence that merely mentions it is not.
import asyncio
from agent import READBACK_REQUEST
s = AgentSession()
s.language = "hindi"
s.pcr = PCR(vital_bp="110/70")
events = asyncio.run(s.handle_segment("Readback karo"))
assert [e["source"] for e in events] == ["readback"] and "110 over 70" in events[0]["text"], events
assert READBACK_REQUEST.search("padh ke sunao") and not READBACK_REQUEST.search("BP 120 over 80")
print("readback shortcut ok")

# A long quote never triggers the slow fuzzy scan; a short close one still matches.
from agent import verify_quote
assert not verify_quote("x" * 500, "y" * 20000)
assert verify_quote("BP 110 over 70", "medic said bp 110  over 70 just now")
print("quote guard ok")

# Errors never echo an API key back to the client.
import os
from main import redact, server_error
os.environ["GNANI_API_KEY"] = "vach_secret_for_test\n"
err = server_error(RuntimeError("invalid X-API-Key-ID header: vach_secret_for_test"), "Agent voice")
assert "vach_secret" not in str(err.detail) and "vach_secret" not in redact("key vach_secret_for_test here")
print("error redaction ok")
