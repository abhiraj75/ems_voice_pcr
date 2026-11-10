import { BASE } from "./api";
import type { Issue, PCR } from "./types";

export type AgentEvent =
  | { type: "ready" }
  | { type: "transcript"; text: string }
  | { type: "pcr"; pcr: PCR }
  | { type: "issues"; issues: Issue[] }
  | { type: "agent_text"; source: "agent" | "alert" | "readback" | "confirm" | "question"; text: string }
  | { type: "speaking"; on: boolean }
  | { type: "stop_audio" }
  | { type: "done" }
  | { type: "turn_done"; spoke: boolean }
  | { type: "error"; error: string }
  | { type: "closed" };

const AGENT_URL = `${BASE.replace(/^http/, "ws")}/ws/agent`;
const TTS_RATE = 24_000;
const PLAYBACK_TAIL_MS = 300; // bridges gaps between speech chunks so the "speaking" state doesn't flicker
const QUIET_PEAK = 200; // out of 32767: below this for a whole press, no real sound reached us

// Runs in a 16 kHz AudioContext (the browser resamples the mic), so it only has to cut
// 512-sample PCM16 frames: the 1024-byte frames Gnani's realtime STT expects, at real-time pace.
const WORKLET = `
class Pcm16Frames extends AudioWorkletProcessor {
  constructor() { super(); this.frame = new Int16Array(512); this.n = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.frame[this.n++] = Math.max(-1, Math.min(1, ch[i])) * 0x7fff;
      if (this.n === 512) { this.port.postMessage(this.frame.buffer.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("pcm16-frames", Pcm16Frames);
`;

/** One live copilot session: streams the mic to /ws/agent and plays the agent's speech. */
export class AgentClient {
  private ws: WebSocket | null = null;
  private mic: MediaStream | null = null;
  private inCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private playAt = 0;
  private sources = new Set<AudioBufferSourceNode>();
  // Push-to-talk: mic audio leaves the browser only while talking. The mic itself stays open so first words aren't clipped.
  private talking = false;
  private peak = 0;
  private playing = false;
  private tailTimer = 0;

  constructor(private onEvent: (event: AgentEvent) => void) {}

  async start() {
    // Created before any await, while the click still counts as a user gesture, or the browser can start them paused.
    this.outCtx = new AudioContext();
    this.inCtx = new AudioContext({ sampleRate: 16_000 });
    void this.outCtx.resume();
    void this.inCtx.resume();
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.inCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const frames = new AudioWorkletNode(this.inCtx, "pcm16-frames", { numberOfOutputs: 0 });
    this.inCtx.createMediaStreamSource(this.mic).connect(frames);

    const ws = new WebSocket(AGENT_URL);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    frames.port.onmessage = (event) => {
      if (!this.talking) return;
      this.peak = Math.max(this.peak, ...new Int16Array(event.data).map(Math.abs));
      if (ws.readyState === WebSocket.OPEN) ws.send(event.data);
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return this.play(event.data);
      const parsed = JSON.parse(event.data) as AgentEvent;
      if (parsed.type === "speaking") return; // the server only knows when it finished sending; playback decides
      if (parsed.type === "stop_audio") this.stopAudio();
      this.onEvent(parsed);
    };
    ws.onerror = () => this.onEvent({ type: "error", error: "Lost connection to the agent." });
    ws.onclose = () => {
      // Let already-scheduled speech finish playing before tearing down audio.
      const remaining = this.outCtx ? Math.max(0, this.playAt - this.outCtx.currentTime) : 0;
      window.setTimeout(() => this.release(), remaining * 1000);
      this.onEvent({ type: "closed" });
    };
  }

  sendText(text: string) {
    this.stopAudio();
    this.send({ type: "text", text });
  }

  /** Start sending the mic; also cuts off the agent if it is speaking. */
  startTalking() {
    this.stopAudio();
    this.peak = 0;
    this.talking = true;
    this.send({ type: "talk_start" });
  }

  stopTalking() {
    this.talking = false;
    this.send({ type: "talk_end" });
    if (this.peak < QUIET_PEAK) {
      this.onEvent({ type: "error", error: "No sound reached the app. Check that the right microphone is selected and not muted." });
    }
  }

  setPcr(pcr: PCR) {
    this.send({ type: "set_pcr", pcr });
  }

  /** Stop listening; the server finishes in-flight turns and speech, then closes. */
  stop() {
    this.mic?.getTracks().forEach((track) => track.stop());
    this.send({ type: "stop" });
  }

  close() {
    this.ws?.close();
    this.release();
  }

  private send(message: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private play(buffer: ArrayBuffer) {
    const ctx = this.outCtx;
    if (!ctx) return;
    const pcm = new Int16Array(buffer);
    const audio = ctx.createBuffer(1, pcm.length, TTS_RATE);
    audio.getChannelData(0).set(Float32Array.from(pcm, (s) => s / 0x8000));
    const source = ctx.createBufferSource();
    source.buffer = audio;
    source.connect(ctx.destination);
    this.playAt = Math.max(this.playAt, ctx.currentTime + 0.05);
    source.start(this.playAt);
    this.playAt += audio.duration;
    this.sources.add(source);
    this.setPlaying(true);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) {
        window.clearTimeout(this.tailTimer);
        this.tailTimer = window.setTimeout(() => this.sources.size === 0 && this.setPlaying(false), PLAYBACK_TAIL_MS);
      }
    };
  }

  private setPlaying(on: boolean) {
    if (on === this.playing) return;
    this.playing = on;
    this.onEvent({ type: "speaking", on });
  }

  private stopAudio() {
    this.sources.forEach((source) => source.stop());
    this.sources.clear();
    this.playAt = 0;
    window.clearTimeout(this.tailTimer);
    this.setPlaying(false);
  }

  private release() {
    this.stopAudio();
    this.mic?.getTracks().forEach((track) => track.stop());
    void this.inCtx?.close();
    void this.outCtx?.close();
    this.mic = this.inCtx = this.outCtx = null;
  }
}
