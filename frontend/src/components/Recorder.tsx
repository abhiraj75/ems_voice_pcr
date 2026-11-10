import { ClipboardPaste, Loader2, Mic, RefreshCcw, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RecorderState } from "../lib/types";
import { bar, barIcon, heading, panel, secondary } from "../lib/ui";

interface RecorderProps {
  state: RecorderState;
  transcript: string;
  error: string | null;
  onAudioReady: (blob: Blob) => Promise<void>;
  onTranscriptReady: (transcript: string) => Promise<void>;
  onRecordingStart: () => void;
  onReset: () => void;
}

const EXAMPLE_TRANSCRIPT =
  "Haan toh yeh patient hai, Ramesh Kumar, 52 saal ka male. Seene mein dard bol raha hai, chest pain, around 3 ghante se. Ghar pe tha, wife ne call kiya tha 108 ko. BP liya 150 over 95, pulse 98, SpO2 94 percent, temp 99. Pain scale 7 out of 10. Skin thodi diaphoretic hai. No known allergies. O2 4 litre nasal cannula diya. Aspirin 325 chewable diya oral, aur IV start kiya normal saline. GCS 15 hai. Le ja rahe hain Victoria Hospital, wife saath mein hai, consent le liya.";

const formatSeconds = (seconds: number) => {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
};

const recordingMimeType = () => {
  const preferred = "audio/webm;codecs=opus";
  return MediaRecorder.isTypeSupported(preferred) ? preferred : "audio/webm";
};

export function Recorder({ state, transcript, error, onAudioReady, onTranscriptReady, onRecordingStart, onReset }: RecorderProps) {
  const [seconds, setSeconds] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const startRecording = async () => {
    setLocalError(null);
    setSeconds(0);
    setPasteMode(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: recordingMimeType() });
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recordingMimeType() });
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(blob));
        await onAudioReady(blob);
      };
      recorder.start();
      onRecordingStart();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not access microphone.");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const handlePasteSubmit = () => {
    const trimmed = pasteText.trim();
    if (!trimmed) return;
    setLocalError(null);
    setPasteMode(false);
    onTranscriptReady(trimmed);
  };

  const handleTryExample = () => {
    setLocalError(null);
    setPasteMode(false);
    onTranscriptReady(EXAMPLE_TRANSCRIPT);
  };


  const busy = state === "transcribing" || state === "extracting";

  return (
    <section className="space-y-4">
      <div className={panel}>
        {state === "idle" && !pasteMode && (
          <>
            <button type="button" onClick={startRecording} className={`${bar} bg-signal hover:bg-signal-dark`}>
              <span className={barIcon}>
                <Mic className="h-7 w-7" />
              </span>
              <span>
                <span className="block font-display text-2xl font-bold leading-tight">Record handoff</span>
                <span className="mt-0.5 block text-sm text-white/85">Tap, speak in Hindi or English, then tap again to stop.</span>
              </span>
            </button>
            <div className="mt-3 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
              <button type="button" onClick={() => setPasteMode(true)} className={`${secondary} justify-center`}>
                <ClipboardPaste className="h-4 w-4" />
                Paste transcript
              </button>
              <button type="button" onClick={handleTryExample} className={`${secondary} justify-center`}>
                <Sparkles className="h-4 w-4" />
                Try an example
              </button>
            </div>
          </>
        )}

        {state === "idle" && pasteMode && (
          <div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-muted">Paste a transcript</span>
              <textarea
                className="min-h-32 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-[15px] text-ink outline-none transition placeholder:text-muted/70 focus:border-ink focus:ring-2 focus:ring-ink/15"
                placeholder="Paste what the paramedic said..."
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                autoFocus
              />
            </label>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handlePasteSubmit}
                disabled={!pasteText.trim()}
                className="rounded-md bg-signal px-4 py-2 text-sm font-bold text-white hover:bg-signal-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/30 disabled:opacity-40"
              >
                Fill report
              </button>
              <button type="button" onClick={() => { setPasteMode(false); setPasteText(""); }} className={secondary}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {state === "recording" && (
          <button type="button" onClick={stopRecording} className={`${bar} bg-ink hover:bg-ink/90`}>
            <span className={barIcon}>
              <Square className="h-6 w-6 fill-current" />
            </span>
            <span className="flex-1">
              <span className="block font-display text-2xl font-bold leading-tight">Stop recording</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-sm text-white/85">
                <span className="h-2 w-2 animate-pulse rounded-full bg-signal motion-reduce:animate-none" />
                Listening
              </span>
            </span>
            <span className="font-display text-4xl font-semibold tabular-nums">{formatSeconds(seconds)}</span>
          </button>
        )}

        {busy && (
          <div className="flex items-center gap-4 rounded-xl bg-cabin px-5 py-6">
            <Loader2 className="h-8 w-8 shrink-0 animate-spin text-ink" />
            <div className="flex-1">
              <p className="font-display text-2xl font-bold leading-tight">
                {state === "transcribing" ? "Transcribing..." : "Filling the report..."}
              </p>
              <p className="mt-0.5 text-sm text-muted">Usually takes a few seconds.</p>
            </div>
            <button type="button" onClick={onReset} className={secondary}>
              Cancel
            </button>
          </div>
        )}

        {state === "ready" && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-cabin px-5 py-4">
            <p className="font-display text-xl font-bold">Transcript ready</p>
            <button type="button" onClick={onReset} className={secondary}>
              <RefreshCcw className="h-4 w-4" />
              Record again
            </button>
          </div>
        )}

        {(localError || error) && (
          <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {localError || error}
          </div>
        )}
      </div>

      {transcript && (
        <div className={panel}>
          <h2 className={heading}>Transcript</h2>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-ink">{transcript}</p>
          {audioUrl && <audio controls src={audioUrl} className="mt-3 h-8 w-full" />}
        </div>
      )}
    </section>
  );
}
