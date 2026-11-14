import clsx from "clsx";

export default function QualityBar({
  value,
  width = "w-28",
  invalid = false,
}: {
  value: number | null;
  width?: string;
  /** File was refused, or never actually analysed (duplicate upload) —
   * the reliability index itself is not meaningful, show that plainly
   * instead of a stale or zero percentage. */
  invalid?: boolean;
}) {
  const pct = value ?? 0;
  const color = invalid ? "bg-gray-300" : pct >= 90 ? "bg-green-500" : pct >= 75 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className={clsx("h-2 rounded-full bg-gray-200", width)}>
        <div
          className={clsx("h-2 rounded-full", color)}
          style={{ width: invalid ? "100%" : `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className={clsx("text-right text-sm font-medium", invalid ? "w-20 text-gray-400" : "w-12 text-gray-700")}>
        {invalid ? "Non valide" : value === null ? "—" : `${pct.toFixed(1)}%`}
      </span>
    </div>
  );
}
