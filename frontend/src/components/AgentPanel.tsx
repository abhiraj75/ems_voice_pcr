import { AlertTriangle, AudioLines, Mic, Send, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { AgentClient, type AgentEvent } from "../lib/agent";
import type { Issue, PCR } from "../lib/types";
import { bar, barIcon, heading, panel, secondary } from "../lib/ui";

interface AgentPanelProps {
  agentRef: MutableRefObject<AgentClient | null>;
  highlight: string | null;
  notes: string | null; // details that fit no report field
  onStart: () => void;
  onPcr: (pcr: PCR) => void;
  onTranscript: (transcript: string) => void;
}

type Status = "idle" | "connecting" | "reconnecting" | "live" | "ending";
type Line = { who: "medic" | "agent" | "alert" | "readback" | "confirm" | "question"; text: string };

const TAP_MS = 300; // shorter than this is a tap (stay on), longer is a hold (release sends)

const severityStyle: Record<Issue["severity"], string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  gap: "border-line bg-cabin text-muted",
};

const lineStyle: Record<Line["who"], string> = {
  medic: "bg-cabin text-ink",
  agent: "bg-voice-soft text-ink",
  alert: "border-l-4 border-signal bg-red-50 font-bold text-red-900",
  readback: "bg-green-50 text-green-900",
  confirm: "bg-emerald-50 text-emerald-900",
  question: "border-l-4 border-voice bg-voice-soft font-bold text-ink",
};

// Wrap the first case-insensitive occurrence of quote in <mark>.
function withHighlight(text: string, quote: string | null) {
  const at = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  if (!quote || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-yellow-200 px-0.5">{text.slice(at, at + quote.length)}</mark>
      {text.slice(at + quote.length)}
    </>
  );
}

export function AgentPanel({ agentRef, highlight, notes, onStart, onPcr, onTranscript }: AgentPanelProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [talking, setTalking] = useState(false);
  const [thinking, setThinking] = useState(false); // released, nothing heard back yet
  const pressedAt = useRef(0);
  const [latched, setLatched] = useState(false); // a quick tap keeps the mic on until the next tap
  const [lines, setLines] = useState<Line[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => agentRef.current?.close(), [agentRef]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    onTranscript(lines.filter((l) => l.who === "medic").map((l) => l.text).join(" "));
  }, [lines, onTranscript]);

  const handleEvent = (event: AgentEvent) => {
    switch (event.type) {
      case "ready":
        return setStatus("live");
      case "transcript":
        return setLines((prev) => [...prev, { who: "medic", text: event.text }]);
      case "agent_text":
        return setLines((prev) => [...prev, { who: event.source, text: event.text }]);
      case "pcr":
        return onPcr(event.pcr);
      case "issues":
        return setIssues(event.issues);
      case "speaking":
        if (event.on) setThinking(false);
        return setSpeaking(event.on);
      case "turn_done":
        if (!event.spoke) setThinking(false);
        return;
      case "error":
        setThinking(false);
        return setError(event.error);
      case "reconnecting":
        setSpeaking(false);
        setTalking(false);
        setThinking(false);
        setLatched(false);
        return setStatus("reconnecting");
      case "closed":
        agentRef.current = null;
        setSpeaking(false);
        setTalking(false);
        setThinking(false);
        setLatched(false);
        return setStatus("idle");
    }
  };

  const start = async () => {
    setError(null);
    setLines([]);
    setIssues([]);
    setStatus("connecting");
    onStart();
    const client = new AgentClient(handleEvent);
    agentRef.current = client;
    try {
      await client.start();
    } catch (err) {
      client.close();
      agentRef.current = null;
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Could not start the live agent.");
    }
  };

  const stopTalking = () => {
    setLatched(false);
    setTalking(false);
    setThinking(true);
    agentRef.current?.stopTalking();
  };

  const press = () => {
    if (latched) return stopTalking();
    pressedAt.current = performance.now();
    setError(null);
    setThinking(false);
    setTalking(true);
    agentRef.current?.startTalking();
  };

  const release = () => {
    if (!talking || latched) return;
    if (performance.now() - pressedAt.current < TAP_MS) return setLatched(true);
    stopTalking();
  };

  const end = () => {
    setStatus("ending");
    agentRef.current?.stop();
  };

  const sendTyped = () => {
    const text = typed.trim();
    if (!text) return;
    agentRef.current?.sendText(text);
    setTyped("");
  };

  const live = status === "live";
  const pttLabel =
    status === "connecting" ? "Connecting..." : status === "reconnecting" ? "Reconnecting..." : status === "ending" ? "Finishing up..." : talking ? "Listening" : speaking ? "Agent speaking" : thinking ? "Thinking..." : "Hold to talk";
  const pttHint = talking
    ? latched ? "Tap to send" : "Release to send"
    : speaking ? "Press to cut in" : live && !thinking ? "Or tap once to start and tap again to send" : "";
  const pttColor = talking ? "bg-signal" : speaking ? "bg-voice" : "bg-ink hover:bg-ink/90";

  return (
    <section className="space-y-4">
      <div className={panel}>
        {status === "idle" ? (
          <button type="button" onClick={start} className={`${bar} bg-signal hover:bg-signal-dark`}>
            <span className={barIcon}>
              <AudioLines className="h-7 w-7" />
            </span>
            <span>
              <span className="block font-display text-2xl font-bold leading-tight">Start live agent</span>
              <span className="mt-0.5 block text-sm text-white/85">It asks for each detail, repeats back what it wrote, and flags risks.</span>
            </span>
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={!live}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                press();
              }}
              onPointerUp={release}
              onPointerCancel={release}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                  event.preventDefault();
                  press();
                }
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") release();
              }}
              className={`${bar} py-8 ${pttColor}`}
              aria-label="Push to talk"
              aria-pressed={talking}
            >
              <span className={`${barIcon} ${talking ? "animate-pulse motion-reduce:animate-none" : ""}`}>
                {speaking && !talking ? <Volume2 className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
              </span>
              <span>
                <span className="block font-display text-3xl font-bold leading-tight">{pttLabel}</span>
                {pttHint && <span className="mt-0.5 block text-sm text-white/85">{pttHint}</span>}
              </span>
            </button>
            <span className="sr-only" aria-live="polite">{pttLabel}</span>

            {live && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <form
                  className="flex min-w-0 flex-1 gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendTyped();
                  }}
                >
                  <input
                    className="w-full min-w-0 rounded-md border border-line bg-white px-3 py-2 text-[15px] text-ink outline-none transition placeholder:text-muted/70 focus:border-ink focus:ring-2 focus:ring-ink/15"
                    placeholder="Too noisy? Type to the agent"
                    aria-label="Type to the agent"
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                  />
                  <button type="submit" disabled={!typed.trim()} className={secondary} aria-label="Send to agent">
                    <Send className="h-4 w-4" />
                  </button>
                </form>
                <button type="button" onClick={end} className={secondary}>
                  <Square className="h-3 w-3 fill-current" />
                  End session
                </button>
              </div>
            )}
          </>
        )}

        {error && <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      </div>

      {issues.length > 0 && (
        <div className={panel}>
          <h2 className={heading}>Safety checks</h2>
          <ul className="mt-3 space-y-2">
            {issues.map((issue) => (
              <li key={issue.id} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${severityStyle[issue.severity]}`}>
                {issue.severity !== "gap" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                {issue.message}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">These checks are illustrative, not clinical guidance.</p>
        </div>
      )}

      {notes && (
        <div className={panel}>
          <h2 className={heading}>Other details</h2>
          <p className="mt-1 text-sm text-muted">Things you said that don't fit a report field.</p>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-6 text-ink">{notes}</p>
        </div>
      )}

      {lines.length > 0 && (
        <div className={panel}>
          <h2 className={heading}>Conversation</h2>
          <div ref={logRef} className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {lines.map((line, i) => (
              <p key={i} className={`rounded-md px-3 py-2 text-[15px] leading-6 ${lineStyle[line.who]} ${line.who === "medic" ? "mr-8" : "ml-8"}`}>
                {line.who === "medic" ? withHighlight(line.text, highlight) : line.text}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
