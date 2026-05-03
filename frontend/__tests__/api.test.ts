import { fetchHealth } from "@/lib/api";

describe("fetchHealth", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns the parsed JSON payload on a 200 response", async () => {
    const payload = { status: "ok", message: "Backend is healthy" };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    }) as unknown as typeof fetch;

    await expect(fetchHealth()).resolves.toEqual(payload);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws when the backend returns a non-2xx status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(fetchHealth()).rejects.toThrow(/500/);
  });

  it("forwards an AbortSignal to fetch so callers can cancel", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", message: "Backend is healthy" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const controller = new AbortController();
    await fetchHealth(controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
