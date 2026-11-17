import { useEffect, useState } from "react";

/** A centered, impossible-to-miss progress indicator for actions that
 * reload/recompute data already on screen (reanalysing a file, or all of
 * them) — as opposed to the small inline bar used for a first import, which
 * doesn't need to grab attention the same way since there's nothing to
 * reread yet.
 *
 * The backend doesn't emit real progress events for these long operations
 * (import, (ré)analyse, qualification…), so there's no genuine percentage
 * to show — a bar that fills up to a fake 80% and then stalls would be
 * worse than no number at all. Instead: a spinning ring (reads as "working",
 * not "X% done") plus a running elapsed-time counter, which is the one
 * thing we *can* say honestly and gives a concrete sense of how long this
 * particular wait has been going on. */
export default function LoadingOverlay({ label }: { label: string }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - start), 200);
    return () => window.clearInterval(id);
  }, []);

  const seconds = elapsedMs / 1000;
  const elapsedLabel = seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20 backdrop-blur-[1px]">
      <div className="flex w-80 flex-col items-center gap-3 rounded-xl bg-white px-6 py-6 text-center shadow-xl">
        <svg className="h-14 w-14 animate-spin text-geneva-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-15" />
          <path
            d="M12 2a10 10 0 0 1 10 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="text-xs tabular-nums text-gray-400">Temps écoulé : {elapsedLabel}</p>
      </div>
    </div>
  );
}
