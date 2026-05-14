import type { PCR } from "./types";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.detail?.error || data?.error || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, "audio.webm");
  const res = await fetch(`${BASE}/api/transcribe`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Transcribe failed: ${await readError(res)}`);
  const data = await res.json();
  return data.transcript;
}

export async function extractPCR(transcript: string): Promise<PCR> {
  const res = await fetch(`${BASE}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok) throw new Error(`Extract failed: ${await readError(res)}`);
  return res.json();
}
