import clsx from "clsx";

const STEPS = [
  { n: 1, label: "Importer les données" },
  { n: 2, label: "Qualifier et analyser" },
  { n: 3, label: "Valider, traiter et reconstruire" },
];

export default function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-4 px-8 py-5">
      {STEPS.map((step, i) => (
        <div key={step.n} className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div
              className={clsx(
                "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                step.n === current
                  ? "bg-geneva-700 text-white"
                  : step.n < current
                  ? "bg-green-500 text-white"
                  : "bg-gray-200 text-gray-500"
              )}
            >
              {step.n < current ? "✓" : step.n}
            </div>
            <span
              className={clsx(
                "text-sm font-medium",
                step.n === current ? "text-geneva-700" : "text-gray-500"
              )}
            >
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && <div className="h-px w-10 bg-gray-300" />}
        </div>
      ))}
    </div>
  );
}
