import { Ambulance, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

const runs = [
  "Run #2451 - Chest pain, 58M - 14:32",
  "Run #2450 - RTA, 24M - 13:15",
  "Run #2449 - Fall, 71F - 11:48",
];

export function FakeSidebar() {
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
              Recent PCRs
            </span>
          ) : (
            <Ambulance className="h-5 w-5 text-red-600" />
          )}
          <button
            type="button"
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
        {open && (
          <div className="space-y-2 p-3">
            {runs.map((run) => (
              <div key={run} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                {run}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
