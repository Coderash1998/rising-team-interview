import type { NextConfig } from "next";

/**
 * The Django backend URL is read from the server-only `BACKEND_URL` env var
 * and never exposed to the browser. All `/api/*` traffic is rewritten on the
 * Next server, so the browser only sees same-origin `/api/...` calls.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Django enforces trailing slashes (APPEND_SLASH=True). Without this,
  // Next would 308-redirect `/api/health/` -> `/api/health`, causing a
  // redirect loop with Django's reverse 301 to add the slash back.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    // `beforeFiles` ensures `/api/*` is proxied to Django even though a
    // fallback Route Handler exists at `app/api/health/route.ts`. Without
    // this, Next would resolve the file-system route first and the proxy
    // would never run.
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${BACKEND_URL}/api/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
