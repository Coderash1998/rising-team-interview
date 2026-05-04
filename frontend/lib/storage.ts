/**
 * localStorage shim for the learning session ID. The full session payload
 * lives on the backend; the client only persists the UUID that lets it
 * re-fetch on reload. Possession of the UUID is the auth.
 */

const KEY = "learning-app/v1/session_id";

export function readSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // localStorage can throw in privacy mode / restricted iframes.
    return null;
  }
}

export function writeSessionId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Best-effort; persistence is a nice-to-have, not a contract.
  }
}

export function clearSessionId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
