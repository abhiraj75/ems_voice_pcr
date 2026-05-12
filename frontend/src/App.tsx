import { useState } from "react";
import { FakeSidebar } from "./components/FakeSidebar";
import { Header } from "./components/Header";
import { PCRForm } from "./components/PCRForm";
import { Recorder } from "./components/Recorder";
import { extractPCR, transcribeAudio } from "./lib/api";
import { emptyPCR, type PCR, type RecorderState } from "./lib/types";

export default function App() {
  const [state, setState] = useState<RecorderState>("idle");
  const [transcript, setTranscript] = useState("");
  const [pcr, setPcr] = useState<PCR>(emptyPCR());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reset = () => {
    setState("idle");
    setTranscript("");
    setPcr(emptyPCR());
    setError(null);
    setToast(null);
  };

  const handleAudioReady = async (blob: Blob) => {
    setError(null);
    try {
      setState("transcribing");
      const nextTranscript = await transcribeAudio(blob);
      setTranscript(nextTranscript);
      setState("extracting");
      const nextPcr = await extractPCR(nextTranscript);
      setPcr(nextPcr);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("idle");
    }
  };

  const handleLooksGood = () => {
    setToast("PCR saved (demo mode)");
    window.setTimeout(reset, 1100);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <div className="flex min-h-[calc(100vh-57px)]">
        <FakeSidebar />
        <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)]">
            <Recorder
              state={state}
              transcript={transcript}
              error={error}
              onAudioReady={handleAudioReady}
              onRecordingStart={() => setState("recording")}
              onReset={reset}
            />

            {state === "ready" ? (
              <PCRForm pcr={pcr} onChange={setPcr} onLooksGood={handleLooksGood} />
            ) : (
              <section className="flex min-h-[520px] items-center justify-center rounded-md border border-dashed border-slate-300 bg-white p-6 text-center">
                <div className="max-w-sm">
                  <p className="text-lg font-extrabold text-slate-950">PCR fields will appear here</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Record a patient handoff to auto-fill the editable clinical report.
                  </p>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-5 right-5 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-800 shadow-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
