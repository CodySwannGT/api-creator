import { describe, it, expect } from "vitest";
import { filterApiRequests } from "../../src/parser/har-reader.js";
import type { HarEntry } from "../../src/types/har.js";

/**
 *
 * @param overrides
 * @param overrides.url
 * @param overrides.method
 * @param overrides.responseMime
 * @param overrides.requestMime
 * @param overrides.resourceType
 * @param overrides.status
 */
function makeEntry(overrides: {
  url?: string;
  method?: string;
  responseMime?: string;
  requestMime?: string;
  resourceType?: string;
  status?: number;
}): HarEntry {
  return {
    startedDateTime: "2024-01-01T00:00:00Z",
    time: 100,
    request: {
      method: overrides.method ?? "GET",
      url: overrides.url ?? "https://api.example.com/users",
      httpVersion: "HTTP/1.1",
      headers: [],
      queryString: [],
      headersSize: 0,
      bodySize: 0,
      cookies: [],
      ...(overrides.requestMime
        ? { postData: { mimeType: overrides.requestMime, text: "{}" } }
        : {}),
    },
    response: {
      status: overrides.status ?? 200,
      statusText: "OK",
      httpVersion: "HTTP/1.1",
      headers: [],
      content: {
        size: 100,
        mimeType: overrides.responseMime ?? "application/json",
      },
      redirectURL: "",
      headersSize: 0,
      bodySize: 100,
      cookies: [],
    },
    _resourceType: overrides.resourceType,
  };
}

describe("filterApiRequests", () => {
  it("keeps JSON API responses", () => {
    const entries = [makeEntry({ responseMime: "application/json" })];
    const result = filterApiRequests(entries);
    expect(result).toHaveLength(1);
  });

  it("keeps XHR resource types", () => {
    const entries = [
      makeEntry({ resourceType: "xhr", responseMime: "text/plain" }),
    ];
    const result = filterApiRequests(entries);
    expect(result).toHaveLength(1);
  });

  it("keeps fetch resource types", () => {
    const entries = [
      makeEntry({ resourceType: "fetch", responseMime: "text/plain" }),
    ];
    const result = filterApiRequests(entries);
    expect(result).toHaveLength(1);
  });

  it("keeps form-urlencoded requests", () => {
    const entries = [
      makeEntry({
        requestMime: "application/x-www-form-urlencoded",
        responseMime: "text/html",
      }),
    ];
    const result = filterApiRequests(entries);
    expect(result).toHaveLength(1);
  });

  it("filters out static resource types", () => {
    const staticTypes = ["image", "font", "stylesheet", "script", "media"];
    for (const type of staticTypes) {
      const entries = [makeEntry({ resourceType: type })];
      const result = filterApiRequests(entries);
      expect(result).toHaveLength(0);
    }
  });

  it("filters out static file extensions", () => {
    const staticUrls = [
      "https://example.com/logo.png",
      "https://example.com/style.css",
      "https://example.com/app.js",
      "https://example.com/font.woff2",
    ];
    for (const url of staticUrls) {
      const entries = [makeEntry({ url, responseMime: "text/plain" })];
      const result = filterApiRequests(entries);
      expect(result).toHaveLength(0);
    }
  });

  it("filters out tracking/analytics URLs", () => {
    const trackingUrls = [
      "https://example.com/api/tracking/event",
      "https://example.com/logging",
      "https://example.com/beacon",
      "https://example.com/analytics/collect",
      "https://example.com/telemetry",
    ];
    for (const url of trackingUrls) {
      const entries = [makeEntry({ url })];
      const result = filterApiRequests(entries);
      expect(result).toHaveLength(0);
    }
  });

  it("filters out ad domain URLs", () => {
    const adUrls = [
      "https://googleads.example.com/ads",
      "https://pagead.example.com/click",
    ];
    for (const url of adUrls) {
      const entries = [makeEntry({ url })];
      const result = filterApiRequests(entries);
      expect(result).toHaveLength(0);
    }
  });

  it("filters out static files like favicon.ico and robots.txt", () => {
    const staticUrls = [
      "https://example.com/favicon.ico",
      "https://example.com/robots.txt",
      "https://example.com/manifest.json",
    ];
    for (const url of staticUrls) {
      const entries = [makeEntry({ url })];
      const result = filterApiRequests(entries);
      expect(result).toHaveLength(0);
    }
  });

  it("filters out $rpc URLs", () => {
    const entries = [makeEntry({ url: "https://example.com/$rpc/something" })];
    const result = filterApiRequests(entries);
    expect(result).toHaveLength(0);
  });

  it("filters out non-API responses without resource type hint", () => {
    const entries = [
      makeEntry({ responseMime: "text/html", resourceType: undefined }),
    ];
    const result = filterApiRequests(entries);
    expect(result).toHaveLength(0);
  });

  it("handles mixed entries correctly", () => {
    const entries = [
      makeEntry({
        url: "https://api.example.com/users",
        responseMime: "application/json",
      }),
      makeEntry({
        url: "https://example.com/logo.png",
        responseMime: "image/png",
        resourceType: "image",
      }),
      makeEntry({
        url: "https://api.example.com/data",
        resourceType: "xhr",
        responseMime: "text/plain",
      }),
    ];
    const result = filterApiRequests(entries);
    expect(result).toHaveLength(2);
  });
});
