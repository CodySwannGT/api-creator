import { describe, it, expect } from "vitest";
import { detectAuth } from "../../src/parser/auth-detector.js";
import type { HarEntry } from "../../src/types/har.js";

/**
 *
 * @param overrides
 * @param overrides.headers
 * @param overrides.cookies
 * @param overrides.queryString
 */
function makeEntry(overrides: {
  headers?: { name: string; value: string }[];
  cookies?: { name: string; value: string }[];
  queryString?: { name: string; value: string }[];
}): HarEntry {
  return {
    startedDateTime: new Date().toISOString(),
    time: 0,
    request: {
      method: "GET",
      url: "https://api.example.com/test",
      httpVersion: "HTTP/1.1",
      headers: overrides.headers ?? [],
      queryString: overrides.queryString ?? [],
      headersSize: -1,
      bodySize: 0,
      cookies: overrides.cookies ?? [],
    },
    response: {
      status: 200,
      statusText: "OK",
      httpVersion: "HTTP/1.1",
      headers: [],
      content: { size: 0, mimeType: "" },
      redirectURL: "",
      headersSize: -1,
      bodySize: -1,
      cookies: [],
    },
  };
}

describe("detectAuth", () => {
  it("detects bearer token in Authorization header", () => {
    const entries = [
      makeEntry({
        headers: [{ name: "Authorization", value: "Bearer abc123" }],
      }),
    ];
    const result = detectAuth(entries);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("bearer");
    expect(result[0].location).toBe("header");
    expect(result[0].key).toBe("Authorization");
    expect(result[0].confidence).toBe(1.0);
  });

  it("detects cookie-based auth", () => {
    const entries = [
      makeEntry({ cookies: [{ name: "session", value: "sess_abc123" }] }),
    ];
    const result = detectAuth(entries);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("cookie");
    expect(result[0].location).toBe("cookie");
    expect(result[0].key).toBe("session");
    expect(result[0].confidence).toBe(0.8);
  });

  it("detects API key header", () => {
    const entries = [
      makeEntry({ headers: [{ name: "X-API-Key", value: "key_12345" }] }),
    ];
    const result = detectAuth(entries);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("api-key");
    expect(result[0].location).toBe("header");
    expect(result[0].confidence).toBe(0.7);
  });

  it("detects query param auth", () => {
    const entries = [
      makeEntry({ queryString: [{ name: "api_key", value: "qk_abc" }] }),
    ];
    const result = detectAuth(entries);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("query-param");
    expect(result[0].location).toBe("query");
    expect(result[0].key).toBe("api_key");
    expect(result[0].confidence).toBe(0.6);
  });

  it("deduplicates and sorts by confidence descending", () => {
    const entries = [
      makeEntry({
        headers: [
          { name: "Authorization", value: "Bearer token1" },
          { name: "X-API-Key", value: "key1" },
        ],
        cookies: [{ name: "session", value: "sess1" }],
        queryString: [{ name: "token", value: "qt1" }],
      }),
    ];
    const result = detectAuth(entries);
    // Should be sorted by confidence: bearer(1.0), cookie(0.8), api-key(0.7), query-param(0.6)
    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result[0].confidence).toBe(1.0);
    expect(result[1].confidence).toBe(0.8);
    expect(result[2].confidence).toBe(0.7);
    expect(result[3].confidence).toBe(0.6);
  });

  it("deduplicates same auth value across multiple entries", () => {
    const entries = [
      makeEntry({
        headers: [{ name: "Authorization", value: "Bearer same-token" }],
      }),
      makeEntry({
        headers: [{ name: "Authorization", value: "Bearer same-token" }],
      }),
      makeEntry({
        headers: [{ name: "Authorization", value: "Bearer same-token" }],
      }),
    ];
    const result = detectAuth(entries);
    // Same value should be deduplicated to a single entry
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("bearer");
  });
});
