import { useCallback, useEffect, useRef, useState } from "react";
import { AgentPanel } from "./components/AgentPanel";
import { Header, type Mode } from "./components/Header";
import { ModeChooser } from "./components/ModeChooser";
import { PCRForm } from "./components/PCRForm";
import { Recorder } from "./components/Recorder";
import { SavedRuns } from "./components/SavedRuns";
import type { AgentClient } from "./lib/agent";
import { extractPCR, transcribeAudio } from "./lib/api";
import { emptyPCR, readbackKey, type PCR, type RecorderState, type SavedPCR } from "./lib/types";

export default function App() {
  const [state, setState] = useState<RecorderState>("idle");
  const [transcript, setTranscript] = useState("");
  const [pcr, setPcr] = useState<PCR>(emptyPCR());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savedRuns, setSavedRuns] = useState<SavedPCR[]>(() => {
    try {
      const raw = localStorage.getItem("ems_saved_pcrs");
      if (!raw) return [];
      return JSON.parse(raw).map((r: SavedPCR & { savedAt: string }) => ({ ...r, savedAt: new Date(r.savedAt) }));
    } catch { return []; }
  });
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [extractionMs, setExtractionMs] = useState<number | null>(null);
  // Readback key the medic confirmed; any edit to vitals/meds changes the key and voids it.
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const vitalsConfirmed = confirmedKey === readbackKey(pcr);
  const genRef = useRef(0);
  const [mode, setMode] = useState<Mode>("record");
  // The chooser opens on a first visit and again from "How it works".
  const [chooserOpen, setChooserOpen] = useState(() => {
    try { return !localStorage.getItem("ems_seen_chooser"); } catch { return true; }
  });
  const closeChooser = () => {
    setChooserOpen(false);
    try { localStorage.setItem("ems_seen_chooser", "1"); } catch { /* private window: show it again next time */ }
  };
  const agentRef = useRef<AgentClient | null>(null);
  // Fields the live agent just changed (flash green) and the evidence quote being hovered.
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("ems_saved_pcrs", JSON.stringify(savedRuns));
  }, [savedRuns]);

  const reset = () => {
    genRef.current += 1;
    agentRef.current?.close();
    setState("idle");
    setTranscript("");
    setPcr(emptyPCR());
    setError(null);
    setToast(null);
    setViewingId(null);
    setExtractionMs(null);
    setConfirmedKey(null);
  };

  const handleAudioReady = async (blob: Blob) => {
    const gen = ++genRef.current;
    setError(null);
    setViewingId(null);
    try {
      setState("transcribing");
      const nextTranscript = await transcribeAudio(blob);
      if (gen !== genRef.current) return;
      setTranscript(nextTranscript);
      setState("extracting");
      const t0 = performance.now();
      const nextPcr = await extractPCR(nextTranscript);
      if (gen !== genRef.current) return;
      setExtractionMs(Math.round(performance.now() - t0));
      setPcr(nextPcr);
      setState("ready");
    } catch (err) {
      if (gen !== genRef.current) return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("idle");
    }
  };

  const handleTranscriptReady = async (text: string) => {
    const gen = ++genRef.current;
    setError(null);
    setViewingId(null);
    try {
      setTranscript(text);
      setState("extracting");
      const t0 = performance.now();
      const nextPcr = await extractPCR(text);
      if (gen !== genRef.current) return;
      setExtractionMs(Math.round(performance.now() - t0));
      setPcr(nextPcr);
      setState("ready");
    } catch (err) {
      if (gen !== genRef.current) return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("idle");
    }
  };

  const handleAgentStart = () => {
    genRef.current += 1;
    setPcr(emptyPCR());
    setTranscript("");
    setError(null);
    setToast(null);
    setViewingId(null);
    setExtractionMs(null);
    setConfirmedKey(null);
    setState("ready");
  };

  const handleAgentPcr = useCallback((next: PCR) => {
    setPcr((prev) => {
      const changed = (Object.keys(next) as (keyof PCR)[]).filter(
        (key) => key !== "evidence" && key !== "unsupported" && JSON.stringify(prev[key]) !== JSON.stringify(next[key]),
      );
      setFlash(new Set(changed));
      return next;
    });
    window.setTimeout(() => setFlash(new Set()), 1500);
  }, []);

  const handlePcrChange = (next: PCR) => {
    setPcr(next);
    agentRef.current?.setPcr(next);
  };

  const handleLooksGood = () => {
    if (viewingId) {
      // Update existing saved run
      setSavedRuns((prev) =>
        prev.map((run) =>
          run.id === viewingId ? { ...run, pcr: { ...pcr }, transcript, vitalsConfirmed } : run
        )
      );
      setToast("Report updated");
    } else {
      // Save new run
      const saved: SavedPCR = {
        id: Date.now(),
        pcr: { ...pcr },
        transcript,
        savedAt: new Date(),
        vitalsConfirmed,
      };
      setSavedRuns((prev) => [saved, ...prev]);
      setToast("Report saved");
    }
    window.setTimeout(reset, 1100);
  };

  const handleSelectRun = (run: SavedPCR) => {
    setPcr({ ...run.pcr });
    setTranscript(run.transcript);
    setViewingId(run.id);
    setConfirmedKey(run.vitalsConfirmed ? readbackKey(run.pcr) : null);
    setState("ready");
    setError(null);
    setToast(null);
  };

  const handleDeleteRun = (id: number) => {
    setSavedRuns((prev) => prev.filter((r) => r.id !== id));
    if (viewingId === id) reset();
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    reset();
    setMode(next);
  };

  return (
    <div className="min-h-screen bg-cabin text-ink print:bg-white">
      <Header mode={mode} onModeChange={switchMode} onHelp={() => setChooserOpen(true)} />
      <ModeChooser
        open={chooserOpen}
        onChoose={(next) => {
          switchMode(next);
          closeChooser();
        }}
        onClose={closeChooser}
      />
      <div className="flex min-h-[calc(100vh-53px)]">
        <SavedRuns runs={savedRuns} activeId={viewingId} onSelect={handleSelectRun} onDelete={handleDeleteRun} />
        <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 print:p-0">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] print:block">
            <div className="print:hidden">
              {mode === "record" ? (
                <Recorder
                  state={state}
                  transcript={transcript}
                  error={error}
                  onAudioReady={handleAudioReady}
                  onTranscriptReady={handleTranscriptReady}
                  onRecordingStart={() => setState("recording")}
                  onReset={reset}
                />
              ) : (
                <AgentPanel
                  agentRef={agentRef}
                  highlight={highlight}
                  notes={pcr.additional_notes}
                  onStart={handleAgentStart}
                  onPcr={handleAgentPcr}
                  onTranscript={setTranscript}
                />
              )}
            </div>

            {state === "ready" ? (
              <PCRForm
                pcr={pcr}
                onChange={handlePcrChange}
                onLooksGood={handleLooksGood}
                isEditing={viewingId !== null}
                extractionMs={extractionMs}
                vitalsConfirmed={vitalsConfirmed}
                onConfirmVitals={() => setConfirmedKey(readbackKey(pcr))}
                flash={flash}
                onEvidenceHover={setHighlight}
              />
            ) : state === "transcribing" || state === "extracting" ? (
              <section className="animate-pulse rounded-xl border border-line bg-white p-5 motion-reduce:animate-none sm:p-6" aria-label="Filling the report">
                <div className="flex items-center justify-between border-b border-line pb-4">
                  <div>
                    <div className="h-7 w-56 rounded bg-line" />
                    <div className="mt-2 h-4 w-64 rounded bg-cabin" />
                  </div>
                  <div className="h-10 w-28 rounded-md bg-line" />
                </div>
                <div className="mt-5 space-y-6">
                  {([
                    { cols: 3, cls: "sm:grid-cols-3" },
                    { cols: 2, cls: "sm:grid-cols-2" },
                    { cols: 3, cls: "sm:grid-cols-3" },
                    { cols: 2, cls: "sm:grid-cols-2" },
                    { cols: 2, cls: "sm:grid-cols-2" },
                  ]).map(({ cols, cls }, sectionIndex) => (
                    <div key={sectionIndex}>
                      <div className="mb-3 h-5 w-24 rounded bg-line" />
                      <div className={`grid gap-4 ${cls}`}>
                        {Array.from({ length: cols }).map((_, i) => (
                          <div key={i}>
                            <div className="mb-1.5 h-3.5 w-14 rounded bg-cabin" />
                            <div className="h-10 rounded-md bg-cabin" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <section className="flex min-h-[520px] items-center justify-center rounded-xl border-2 border-dashed border-line p-6 text-center">
                <div className="max-w-sm">
                  <p className="font-display text-2xl font-bold text-ink">No report yet</p>
                  <p className="mt-2 text-[15px] leading-6 text-muted">
                    {mode === "record"
                      ? "Record a handoff and the report fills in here for you to check."
                      : "Start the live agent. The report fills in here as you answer its questions."}
                  </p>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      {toast && (
        <div role="status" className="print:hidden fixed bottom-5 right-5 rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
