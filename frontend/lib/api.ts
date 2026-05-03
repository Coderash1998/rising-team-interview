import { logger } from "./logger";

export type HealthStatus = "loading" | "healthy" | "down";

export interface HealthResponse {
  status: string;
  message: string;
}

/**
 * Fetches the backend health status via the same-origin Next proxy. The
 * caller passes an AbortSignal so rapid input changes can cancel stale
 * requests (see TypingInput / page.tsx).
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  logger.info("api: fetchHealth start");
  const response = await fetch("/api/health", {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    logger.error("api: fetchHealth non-2xx", { status: response.status });
    throw new Error(`Health check failed: ${response.status}`);
  }
  const data = (await response.json()) as HealthResponse;
  logger.info("api: fetchHealth ok", data);
  return data;
}
