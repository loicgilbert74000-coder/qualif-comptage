/** Indeterminate progress bar shown while the server is importing, analysing
 * or reanalysing data (we don't get real progress events from the backend
 * for this, so this communicates "work in progress" rather than "% done"). */
export default function ProgressBar({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <div className={className}>
      {label && <p className="mb-1.5 text-sm text-geneva-700">{label}</p>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-geneva-50">
        <div className="h-full w-1/3 animate-progress-indeterminate rounded-full bg-geneva-600" />
      </div>
    </div>
  );
}
