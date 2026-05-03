import { NextResponse } from "next/server";

/**
 * Optional Next-side health endpoint. The browser hits `/api/health/` which
 * the rewrite in `next.config.ts` forwards to Django. This file is the
 * fallback used when the rewrite is bypassed (e.g., when running the Next
 * server standalone with the backend offline) so curl/health probes against
 * the Next process never 404.
 *
 * Note: rewrites take precedence over App Router routes, so in normal
 * operation this handler is unreachable.
 */
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      message: "Frontend proxy reachable; backend rewrite should supersede this handler.",
      source: "next-fallback",
    },
    { status: 200 },
  );
}
