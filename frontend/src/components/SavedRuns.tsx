import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import type { SavedPCR } from "../lib/types";
import { heading } from "../lib/ui";

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
      className={`hidden shrink-0 border-r border-line bg-white transition-all duration-200 lg:block print:hidden ${
        open ? "w-72" : "w-16"
      }`}
    >
      <div className="flex h-full flex-col">
        {/* px-6 matches the header, so "Saved reports" lines up under "108" */}
        <div className={`flex items-center border-b border-line py-3 ${open ? "justify-between px-6" : "justify-center"}`}>
          {open && (
            <h2 className={heading}>
              Saved reports ({runs.length})
            </h2>
          )}
          <button
            type="button"
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            className="rounded-md border border-line p-1.5 text-muted hover:bg-cabin"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
        {open && (
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {runs.length === 0 ? (
              <p className="px-3 py-2 text-sm leading-6 text-muted">
                No saved reports yet. Reports you save show up here.
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
                    className={`w-full cursor-pointer rounded-md border px-3 py-2 text-left transition hover:bg-cabin ${
                      activeId === run.id
                        ? "border-ink bg-cabin"
                        : "border-line"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold text-ink">
                          {run.pcr.chief_complaint || "Unknown complaint"}
                        </p>
                        <p className="mt-0.5 text-sm text-muted">
                          {run.pcr.patient_age ? `${run.pcr.patient_age}${run.pcr.patient_gender === "male" ? "M" : run.pcr.patient_gender === "female" ? "F" : ""}` : "Age unknown"}
                          {", "}
                          {formatTime(run.savedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label="Delete report"
                        onClick={(e) => { e.stopPropagation(); onDelete(run.id); }}
                        className="shrink-0 rounded p-0.5 text-muted hover:bg-red-50 hover:text-red-600"
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
