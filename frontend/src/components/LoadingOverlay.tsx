import ProgressBar from "./ProgressBar";

/** A centered, impossible-to-miss progress indicator for actions that
 * reload/recompute data already on screen (reanalysing a file, or all of
 * them) — as opposed to the small inline bar used for a first import, which
 * doesn't need to grab attention the same way since there's nothing to
 * reread yet. */
export default function LoadingOverlay({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20 backdrop-blur-[1px]">
      <div className="w-80 rounded-xl bg-white px-6 py-5 text-center shadow-xl">
        <p className="mb-3 text-sm font-medium text-gray-700">{label}</p>
        <ProgressBar />
      </div>
    </div>
  );
}
