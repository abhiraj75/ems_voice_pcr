import type { PCR } from "./types";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// The backend sleeps after inactivity and can take ~30s to cold start. 
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

const SAMPLE_RATE = 16_000;
// Prisma accepts max 60s per request (30s recommended).
// ponytail: hard cut at 30s may split a word; overlap chunks if transcripts show it.
const CHUNK_SECONDS = 30;

function encodeWav(samples: Float32Array): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([view], { type: "audio/wav" });
}

// Browser records WebM/Opus, which Prisma doesn't accept: decode, resample to 16 kHz mono, split into WAV chunks.
async function toWavChunks(blob: Blob): Promise<Blob[]> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  void ctx.close();
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);
  const size = CHUNK_SECONDS * SAMPLE_RATE;
  const chunks: Blob[] = [];
  for (let i = 0; i < samples.length; i += size) chunks.push(encodeWav(samples.subarray(i, i + size)));
  return chunks;
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData();
  (await toWavChunks(blob)).forEach((chunk, i) => form.append("audio", chunk, `audio-${i}.wav`));
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

export async function readbackAudio(pcr: PCR): Promise<Blob> {
  const res = await fetchWithTimeout(`${BASE}/api/readback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pcr),
  });
  if (!res.ok) throw new Error(`Readback failed: ${await readError(res)}`);
  return res.blob();
}
