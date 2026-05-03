"use client";

import type { HealthStatus } from "@/lib/api";

interface HealthBadgeProps {
  status: HealthStatus;
}

const COPY: Record<HealthStatus, { label: string; tone: string }> = {
  loading: {
    label: "Checking…",
    tone: "text-terminal-dim border-terminal-dim/40",
  },
  healthy: {
    label: "Healthy",
    tone: "text-terminal-green border-terminal-green/60 shadow-[0_0_12px_rgba(57,255,20,0.45)]",
  },
  down: {
    label: "Down",
    tone: "text-red-400 border-red-500/60 shadow-[0_0_10px_rgba(248,113,113,0.45)]",
  },
};

export function HealthBadge({ status }: HealthBadgeProps) {
  const { label, tone } = COPY[status];
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="health-badge"
      data-status={status}
      className={`inline-flex items-center gap-2 rounded-full border bg-black/40 px-3 py-1 font-mono text-xs uppercase tracking-widest ${tone}`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          status === "healthy"
            ? "bg-terminal-green"
            : status === "down"
              ? "bg-red-500"
              : "bg-terminal-dim animate-pulse"
        }`}
      />
      {label}
    </span>
  );
}
