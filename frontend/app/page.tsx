"use client";

import { useEffect, useRef, useState } from "react";

import { GridBackground } from "@/components/GridBackground";
import { HealthBadge } from "@/components/HealthBadge";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import {
  deleteSession,
  fetchHealth,
  fetchSession,
  type HealthStatus,
  type SessionDetail,
} from "@/lib/api";
import { logger } from "@/lib/logger";
import { clearSessionId, readSessionId, writeSessionId } from "@/lib/storage";

type Hydration = "loading" | "ready";

export default function HomePage() {
  const [health, setHealth] = useState<HealthStatus>("loading");
  const [hydration, setHydration] = useState<Hydration>("loading");
  const [session, setSession] = useState<SessionDetail | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logger.info("HomePage mounted");
    runHealthCheck();
    hydrateFromStorage();
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
      if ((error as Error).name === "AbortError") return;
      logger.error("health -> down", error);
      setHealth("down");
    }
  }

  async function hydrateFromStorage() {
    const sessionId = readSessionId();
    if (!sessionId) {
      logger.info("hydrate: no stored session");
      setHydration("ready");
      return;
    }
    try {
      const restored = await fetchSession(sessionId);
      if (restored) {
        logger.info("hydrate: restored session", {
          topic: restored.input.topic,
          lessons: restored.plan.lessons.length,
        });
        setSession(restored);
      } else {
        // 404: stored ID is stale — purge it so the user re-onboards cleanly.
        logger.warn("hydrate: stored session_id is stale, clearing");
        clearSessionId();
      }
    } catch (error) {
      // Network or 5xx — keep the stored ID, surface as "ready" so the user
      // can still start a new session manually if they want.
      logger.error("hydrate: failed", error);
    } finally {
      setHydration("ready");
    }
  }

  function handlePersistSession(detail: SessionDetail) {
    writeSessionId(detail.session_id);
    setSession(detail);
  }

  async function handleReset() {
    const stored = readSessionId();
    clearSessionId();
    setSession(null);
    if (stored) {
      try {
        await deleteSession(stored);
      } catch (error) {
        // We've already cleared client state; backend cleanup is best-effort.
        logger.error("reset: backend delete failed (ignoring)", error);
      }
    }
  }

  return (
    <main className="relative z-10 flex min-h-screen flex-col">
      <GridBackground />

      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500">
          rising-team / interview
        </div>
        <HealthBadge status={health} />
      </header>

      <section className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full">
          {!session && (
            <div className="mb-10 text-center">
              <h1 className="shimmer-text mx-auto max-w-3xl text-4xl font-semibold leading-[1.2] sm:text-5xl">
                Let&apos;s build your plan.
              </h1>
              <p className="mt-3 text-sm text-zinc-500 sm:text-base">
                Three quick questions. Takes under a minute.
              </p>
            </div>
          )}

          {hydration === "loading" ? (
            <div className="text-center font-mono text-xs uppercase tracking-[0.25em] text-zinc-600">
              Restoring your session…
            </div>
          ) : (
            <OnboardingFlow
              hydratedSession={session}
              onPersist={handlePersistSession}
              onReset={handleReset}
            />
          )}
        </div>
      </section>
    </main>
  );
}
