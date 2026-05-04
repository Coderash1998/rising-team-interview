"use client";

interface StepIndicatorProps {
  current: number;
  total: number;
  labels?: string[];
}

/**
 * Compact step indicator: numbered dots connected by a thin track. Dots ahead
 * of `current` are dim, the active dot is the bright accent, completed dots
 * are filled in the success colour.
 */
export function StepIndicator({ current, total, labels }: StepIndicatorProps) {
  const steps = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <ol
      className="flex items-center justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-500"
      data-testid="step-indicator"
    >
      {steps.map((step, idx) => {
        const isActive = step === current;
        const isComplete = step < current;
        const dotClass = isComplete
          ? "bg-emerald-400 border-emerald-400 text-black"
          : isActive
            ? "border-emerald-300 text-emerald-200 shadow-[0_0_12px_rgba(110,231,183,0.45)]"
            : "border-zinc-700 text-zinc-600";
        return (
          <li key={step} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                aria-current={isActive ? "step" : undefined}
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[12px] font-semibold transition-colors ${dotClass}`}
              >
                {step}
              </span>
              {labels?.[idx] && (
                <span
                  className={`hidden sm:inline ${
                    isActive ? "text-zinc-200" : isComplete ? "text-zinc-400" : ""
                  }`}
                >
                  {labels[idx]}
                </span>
              )}
            </div>
            {idx < steps.length - 1 && (
              <span
                className={`h-px w-8 transition-colors sm:w-12 ${
                  isComplete ? "bg-emerald-400/60" : "bg-zinc-700"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
