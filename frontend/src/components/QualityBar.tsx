import clsx from "clsx";

export default function QualityBar({ value, width = "w-28" }: { value: number | null; width?: string }) {
  const pct = value ?? 0;
  const color = pct >= 90 ? "bg-green-500" : pct >= 75 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className={clsx("h-2 rounded-full bg-gray-200", width)}>
        <div className={clsx("h-2 rounded-full", color)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="w-12 text-right text-sm font-medium text-gray-700">
        {value === null ? "—" : `${pct.toFixed(1)}%`}
      </span>
    </div>
  );
}
