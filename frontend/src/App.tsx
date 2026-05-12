import { useState } from "react";
import { Header } from "./components/Header";
import { PCRForm } from "./components/PCRForm";
import { Recorder } from "./components/Recorder";
import { SavedRuns } from "./components/SavedRuns";
import { extractPCR, transcribeAudio } from "./lib/api";
import { emptyPCR, type PCR, type RecorderState, type SavedPCR } from "./lib/types";

export default function App() {
  const [state, setState] = useState<RecorderState>("idle");
  const [transcript, setTranscript] = useState("");
  const [pcr, setPcr] = useState<PCR>(emptyPCR());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savedRuns, setSavedRuns] = useState<SavedPCR[]>([]);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const reset = () => {
    setState("idle");
    setTranscript("");
    setPcr(emptyPCR());
    setError(null);
    setToast(null);
    setViewingId(null);
  };

  const handleAudioReady = async (blob: Blob) => {
    setError(null);
    setViewingId(null);
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
    if (viewingId) {
      // Update existing saved run
      setSavedRuns((prev) =>
        prev.map((run) =>
          run.id === viewingId ? { ...run, pcr: { ...pcr }, transcript } : run
        )
      );
      setToast("PCR updated");
    } else {
      // Save new run
      const saved: SavedPCR = {
        id: Date.now(),
        pcr: { ...pcr },
        transcript,
        savedAt: new Date(),
      };
      setSavedRuns((prev) => [saved, ...prev]);
      setToast("PCR saved");
    }
    window.setTimeout(reset, 1100);
  };

  const handleSelectRun = (run: SavedPCR) => {
    setPcr({ ...run.pcr });
    setTranscript(run.transcript);
    setViewingId(run.id);
    setState("ready");
    setError(null);
    setToast(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <div className="flex min-h-[calc(100vh-57px)]">
        <SavedRuns runs={savedRuns} activeId={viewingId} onSelect={handleSelectRun} />
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
              <PCRForm
                pcr={pcr}
                onChange={setPcr}
                onLooksGood={handleLooksGood}
                isEditing={viewingId !== null}
              />
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
