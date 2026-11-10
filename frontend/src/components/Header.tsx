import { CircleHelp, Play } from "lucide-react";

const topLink =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-bold text-muted hover:bg-cabin hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30";

export type Mode = "record" | "live";

interface HeaderProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onHelp: () => void;
}

const MODES: { mode: Mode; label: string }[] = [
  { mode: "record", label: "Record" },
  { mode: "live", label: "Live agent" },
];

export function Header({ mode, onModeChange, onHelp }: HeaderProps) {
  return (
    <header className="border-b border-line bg-white print:hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
        <p className="flex shrink-0 items-center gap-2 font-display text-lg font-bold text-ink">
          <span className="rounded bg-signal px-1.5 leading-7 text-white">108</span>
          <span className="hidden sm:inline">Voice PCR</span>
        </p>
        <div role="tablist" aria-label="How to fill the report" className="ml-auto flex rounded-lg bg-cabin p-1 text-sm font-bold">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="tab"
              aria-selected={mode === m.mode}
              onClick={() => onModeChange(m.mode)}
              className={`rounded-md px-3 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 ${mode === m.mode ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center">
          <button type="button" onClick={onHelp} className={topLink} aria-label="How it works">
            <CircleHelp className="h-5 w-5" />
            <span className="hidden md:inline">How it works</span>
          </button>
          <a
            href="https://drive.google.com/file/d/14SPFbeeidzZUDXFPWupayFaEAQakvfwg/view?usp=sharing"
            target="_blank"
            rel="noopener noreferrer"
            className={topLink}
            aria-label="Watch demo video"
          >
            <Play className="h-5 w-5" />
            <span className="hidden md:inline">Watch demo</span>
          </a>
        </div>
      </div>
    </header>
  );
}
