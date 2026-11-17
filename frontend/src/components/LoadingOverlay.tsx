/** A centered, impossible-to-miss progress indicator for actions that
 * reload/recompute data already on screen (reanalysing a file, or all of
 * them) — as opposed to the small inline bar used for a first import, which
 * doesn't need to grab attention the same way since there's nothing to
 * reread yet.
 *
 * The backend doesn't emit real progress events for these long operations
 * (import, (ré)analyse, qualification…), so there's no genuine percentage
 * to show — a bar that fills up to a fake 80% and then stalls would be
 * worse than no number at all. Instead: a spinning ring, which reads as
 * "working", not "X% done". */
export default function LoadingOverlay({ label }: { label: string }) {
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
      </div>
    </div>
  );
}
