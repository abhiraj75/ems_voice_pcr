import { ChevronLeft, ChevronRight, ClipboardList, X } from "lucide-react";
import { useState } from "react";
import type { SavedPCR } from "../lib/types";

interface SavedRunsProps {
  runs: SavedPCR[];
  activeId: number | null;
  onSelect: (run: SavedPCR) => void;
  onDelete: (id: number) => void;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function SavedRuns({ runs, activeId, onSelect, onDelete }: SavedRunsProps) {
  const [open, setOpen] = useState(true);

  return (
    <aside
      className={`hidden border-r border-slate-200 bg-white transition-all duration-200 lg:block ${
        open ? "w-72" : "w-16"
      }`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          {open ? (
            <span className="text-xs font-bold uppercase tracking-normal text-slate-500">
              Saved PCRs ({runs.length})
            </span>
          ) : (
            <ClipboardList className="h-5 w-5 text-red-600" />
          )}
          <button
            type="button"
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
        {open && (
          <div className="flex-1 overflow-y-auto p-3">
            {runs.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-slate-400">
                No saved PCRs yet. Record a handoff to get started.
              </p>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <div
                    key={run.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(run)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(run); }}
                    className={`w-full cursor-pointer rounded-md border px-3 py-2 text-left transition hover:bg-slate-50 ${
                      activeId === run.id
                        ? "border-red-300 bg-red-50"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">
                          {run.pcr.chief_complaint || "Unknown complaint"}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {run.pcr.patient_age ? `${run.pcr.patient_age}${run.pcr.patient_gender === "male" ? "M" : run.pcr.patient_gender === "female" ? "F" : ""}` : "Age unknown"}
                          {" · "}
                          {formatTime(run.savedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label="Delete PCR"
                        onClick={(e) => { e.stopPropagation(); onDelete(run.id); }}
                        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
