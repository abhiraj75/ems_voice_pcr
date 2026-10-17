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
print("ok")
