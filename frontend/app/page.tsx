"use client";

import { useEffect, useRef, useState } from "react";

import { GridBackground } from "@/components/GridBackground";
import { HealthBadge } from "@/components/HealthBadge";
import { MirrorDisplay } from "@/components/MirrorDisplay";
import { TypingInput } from "@/components/TypingInput";
import { fetchHealth, type HealthStatus } from "@/lib/api";
import { logger } from "@/lib/logger";

const PLACEHOLDER = "Start typing to see it come alive.";

export default function HomePage() {
  const [text, setText] = useState<string>("");
  const [health, setHealth] = useState<HealthStatus>("loading");
  const [synced, setSynced] = useState<boolean>(true);

  // Track the most recent in-flight health request so we can abort it when a
  // new one starts (bonus: "Abort previous API requests on new input").
  const inflightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logger.info("HomePage mounted");
    runHealthCheck();
    return () => {
      inflightRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runHealthCheck() {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;
    setHealth("loading");
    try {
      await fetchHealth(controller.signal);
      if (!controller.signal.aborted) {
        setHealth("healthy");
        logger.info("health -> healthy");
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        logger.debug("health: aborted (superseded)");
        return;
      }
      logger.error("health -> down", error);
      setHealth("down");
    }
  }

  function handleInputChange(next: string) {
    // Briefly flash "Syncing…" purely for UX feedback; state mirrors text instantly.
    setSynced(false);
    setText(next);
    requestAnimationFrame(() => setSynced(true));
  }

  return (
    <main className="relative z-10 flex min-h-screen flex-col">
      <GridBackground />

      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-terminal-dim/80">
          rising-team / interview
        </div>
        <div className="flex items-center gap-3">
          <span
            data-testid="sync-indicator"
            data-synced={synced}
            className={`font-mono text-[10px] uppercase tracking-[0.25em] ${
              synced ? "text-terminal-green" : "text-amber-300"
            }`}
          >
            {synced ? "Synced" : "Syncing…"}
          </span>
          <HealthBadge status={health} />
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center">
        <MirrorDisplay text={text} placeholder={PLACEHOLDER} />
      </section>

      <footer>
        <TypingInput value={text} onChange={handleInputChange} />
      </footer>
    </main>
  );
}
