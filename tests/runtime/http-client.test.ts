import { describe, it, expect, vi, beforeEach } from "vitest";
import { httpRequest, HttpError } from "../../src/runtime/http-client.js";

describe("HttpError", () => {
  it("includes status and body", () => {
    const err = new HttpError(404, "Not Found");
    expect(err.status).toBe(404);
    expect(err.body).toBe("Not Found");
    expect(err.name).toBe("HttpError");
    expect(err.message).toBe("HTTP 404");
  });

  it("includes session hint for 401", () => {
    const err = new HttpError(401, "");
    expect(err.message).toContain("session may have expired");
  });

  it("includes session hint for 403", () => {
    const err = new HttpError(403, "Forbidden");
    expect(err.message).toContain("session may have expired");
  });

  it("does not include hint for 500", () => {
    const err = new HttpError(500, "Server Error");
    expect(err.message).not.toContain("session");
  });
});

describe("httpRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("makes a successful GET request", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ data: "test" }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await httpRequest({
      baseUrl: "https://api.example.com",
      path: "/users",
      method: "get",
      auth: {},
    });

    expect(result).toEqual({ data: "test" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/users",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("throws HttpError for non-2xx response", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue("Not Found"),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await expect(
      httpRequest({
        baseUrl: "https://api.example.com",
        path: "/missing",
        method: "get",
        auth: {},
      })
    ).rejects.toThrow(HttpError);
  });

  it("sends cookie auth header", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await httpRequest({
      baseUrl: "https://api.example.com",
      path: "/data",
      method: "get",
      auth: { cookie: "session=abc" },
    });

    const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers;
    expect(callHeaders.Cookie).toBe("session=abc");
  });

  it("sends bearer token auth header", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await httpRequest({
      baseUrl: "https://api.example.com",
      path: "/data",
      method: "get",
      auth: { token: "my-token" },
    });

    const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers;
    expect(callHeaders.Authorization).toBe("Bearer my-token");
  });

  it("sends API key auth header", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await httpRequest({
      baseUrl: "https://api.example.com",
      path: "/data",
      method: "get",
      auth: { apiKey: "key-123" },
    });

    const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers;
    expect(callHeaders["X-API-Key"]).toBe("key-123");
  });

  it("sends extra headers", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await httpRequest({
      baseUrl: "https://api.example.com",
      path: "/data",
      method: "get",
      auth: { cookie: "c=1", extraHeaders: { "x-custom": "val" } },
    });

    const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers;
    expect(callHeaders["x-custom"]).toBe("val");
  });

  it("appends query params to URL", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await httpRequest({
      baseUrl: "https://api.example.com",
      path: "/search",
      method: "get",
      auth: {},
      queryParams: { q: "test", limit: "10" },
    });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUrl).toContain("q=test");
    expect(calledUrl).toContain("limit=10");
  });

  it("skips empty query param values", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await httpRequest({
      baseUrl: "https://api.example.com",
      path: "/search",
      method: "get",
      auth: {},
      queryParams: { q: "test", empty: "" },
    });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUrl).toContain("q=test");
    expect(calledUrl).not.toContain("empty");
  });

  it("sends JSON body and Content-Type header", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ id: 1 }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await httpRequest({
      baseUrl: "https://api.example.com",
      path: "/users",
      method: "post",
      auth: {},
      body: { name: "test" },
    });

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.headers["Content-Type"]).toBe("application/json");
    expect(callArgs.body).toBe('{"name":"test"}');
    expect(callArgs.method).toBe("POST");
  });

  it("does not send Content-Type without body", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await httpRequest({
      baseUrl: "https://api.example.com",
      path: "/data",
      method: "get",
      auth: {},
    });

    const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers;
    expect(callHeaders["Content-Type"]).toBeUndefined();
  });
});
