import { AudioLines, Mic, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Mode } from "./Header";

interface ModeChooserProps {
  open: boolean;
  onChoose: (mode: Mode) => void;
  onClose: () => void;
}

const OPTIONS = [
  {
    mode: "record" as const,
    icon: Mic,
    title: "Record a handoff",
    body: "Speak the whole handoff in one go. When you stop, the report fills in and you check it before saving.",
    fit: "Best when you already have every detail.",
  },
  {
    mode: "live" as const,
    icon: AudioLines,
    title: "Talk to the live agent",
    body: "The agent asks for each detail in Hindi or English, repeats back what it wrote, and warns you about risks such as a drug the patient is allergic to. You can also ask it questions, like what GCS means or which medicines were given.",
    fit: "Best while you're still with the patient.",
  },
];

export function ModeChooser({ open, onChoose, onClose }: ModeChooserProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && onClose()}
      aria-labelledby="chooser-title"
      className="w-[min(46rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-0 text-ink backdrop:bg-ink/50"
    >
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <h2 id="chooser-title" className="font-display text-3xl font-bold leading-tight">
            How do you want to fill this report?
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-cabin hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {OPTIONS.map(({ mode, icon: Icon, title, body, fit }) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChoose(mode)}
              className="group flex flex-col rounded-xl border-2 border-line p-5 text-left transition hover:border-ink focus-visible:border-ink focus-visible:outline-none"
            >
              <span className={`flex h-12 w-12 items-center justify-center rounded-full text-white ${mode === "live" ? "bg-voice" : "bg-signal"}`}>
                <Icon className="h-6 w-6" />
              </span>
              <span className="mt-4 font-display text-xl font-bold">{title}</span>
              <span className="mt-1.5 text-[15px] leading-6 text-ink/80">{body}</span>
              <span className="mt-auto pt-4 text-sm font-bold text-muted group-hover:text-ink">{fit}</span>
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm text-muted">You can switch between them any time from the top bar.</p>
      </div>
    </dialog>
  );
}
