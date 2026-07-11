import type { PCR } from "./types";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// The backend runs on Render's free tier, which sleeps after inactivity and can
// take ~30s to cold start. Give requests a generous ceiling so a sleeping
// backend surfaces a clear error instead of hanging indefinitely.
const REQUEST_TIMEOUT_MS = 60_000;

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.detail?.error || data?.error || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        "Request timed out. The backend may be waking from sleep- try again in a moment."
      );
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, "audio.webm");
  const res = await fetchWithTimeout(`${BASE}/api/transcribe`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Transcribe failed: ${await readError(res)}`);
  const data = await res.json();
  return data.transcript;
}

export async function extractPCR(transcript: string): Promise<PCR> {
  const res = await fetchWithTimeout(`${BASE}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok) throw new Error(`Extract failed: ${await readError(res)}`);
  return res.json();
}
