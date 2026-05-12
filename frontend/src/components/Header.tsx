export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold tracking-normal text-slate-950 sm:text-base">
            108 Karnataka EMS - Voice PCR
          </p>
        </div>
        <div className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 sm:text-sm">
          Crew: Paramedic Sharma
        </div>
      </div>
    </header>
  );
}
