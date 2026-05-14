import { ClipboardPaste, Mic, RefreshCcw, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RecorderState } from "../lib/types";

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
    setPasteMode(false);
    onTranscriptReady(trimmed);
  };

  const handleTryExample = () => {
    setPasteMode(false);
    onTranscriptReady(EXAMPLE_TRANSCRIPT);
  };

  const busy = state === "transcribing" || state === "extracting";

  return (
    <section className="space-y-5">
      <div className="rounded-md border border-slate-200 bg-white p-5">
        <div className="flex flex-col items-center py-5 text-center">
          {state === "idle" && !pasteMode && (
            <>
              <button
                type="button"
                onClick={startRecording}
                className="flex h-28 w-28 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-100"
                aria-label="Start recording"
              >
                <Mic className="h-10 w-10" />
              </button>
              <p className="mt-4 text-base font-semibold text-slate-900">Tap to record patient handoff</p>
              <p className="mt-1 text-sm text-slate-500">Speak naturally in Hinglish or English.</p>

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPasteMode(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  Paste transcript
                </button>
                <button
                  type="button"
                  onClick={handleTryExample}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Try an example
                </button>
              </div>
            </>
          )}

          {state === "idle" && pasteMode && (
            <div className="w-full text-left">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-normal text-slate-500">Paste transcript</span>
                <textarea
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-red-600 focus:ring-2 focus:ring-red-100 min-h-32 resize-y"
                  placeholder="Paste a paramedic voice transcript here..."
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
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:opacity-40"
                >
                  Extract PCR
                </button>
                <button
                  type="button"
                  onClick={() => { setPasteMode(false); setPasteText(""); }}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {state === "recording" && (
            <>
              <button
                type="button"
                onClick={stopRecording}
                className="flex h-28 w-28 animate-pulse items-center justify-center rounded-md bg-red-600 text-white transition hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-100"
                aria-label="Stop recording"
              >
                <Square className="h-9 w-9 fill-current" />
              </button>
              <p className="mt-4 font-mono text-4xl font-bold text-slate-950">{formatSeconds(seconds)}</p>
              <div className="mt-4 flex h-8 items-center gap-2">
                <span className="h-3 w-3 animate-bounce rounded-full bg-red-500 [animation-delay:-0.2s]" />
                <span className="h-3 w-3 animate-bounce rounded-full bg-red-500 [animation-delay:-0.1s]" />
                <span className="h-3 w-3 animate-bounce rounded-full bg-red-500" />
              </div>
            </>
          )}

          {busy && (
            <>
              <div className="h-16 w-16 animate-spin rounded-full border-4 border-slate-200 border-t-red-600" />
              <p className="mt-4 text-base font-semibold text-slate-900">
                {state === "transcribing" ? "Transcribing..." : "Extracting PCR fields..."}
              </p>
              <p className="mt-1 text-sm text-slate-500">This is the magic bit. Give it a moment.</p>
              <button
                type="button"
                onClick={onReset}
                className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </>
          )}

          {state === "ready" && (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-green-200 bg-green-50 text-green-700">
                <Mic className="h-7 w-7" />
              </div>
              <p className="mt-4 text-base font-semibold text-slate-900">Transcript ready</p>
              <button
                type="button"
                onClick={onReset}
                className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RefreshCcw className="h-4 w-4" />
                Record again
              </button>
            </>
          )}
        </div>

        {(localError || error) && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {localError || error}
          </div>
        )}
      </div>

      {transcript && (
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold uppercase tracking-normal text-slate-500">Transcript</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">{transcript}</p>
          {audioUrl && (
            <audio controls src={audioUrl} className="mt-3 w-full h-8" />
          )}
        </div>
      )}
    </section>
  );
}
