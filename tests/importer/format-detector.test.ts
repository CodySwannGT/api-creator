import { describe, it, expect } from "vitest";
import { detectFormat } from "../../src/importer/format-detector.js";

describe("detectFormat", () => {
  it("detects cURL format", () => {
    expect(detectFormat("curl 'https://api.example.com/users'")).toBe("curl");
  });

  it("detects cURL with leading whitespace", () => {
    expect(detectFormat("  curl https://api.example.com/users")).toBe("curl");
  });

  it("detects fetch format", () => {
    expect(detectFormat("fetch('https://api.example.com/users')")).toBe(
      "fetch"
    );
  });

  it("detects await fetch format", () => {
    expect(detectFormat("await fetch('https://api.example.com/users')")).toBe(
      "fetch"
    );
  });

  it("detects HAR format", () => {
    const har = JSON.stringify({
      log: {
        version: "1.2",
        creator: { name: "test", version: "1.0" },
        entries: [],
      },
    });
    expect(detectFormat(har)).toBe("har");
  });

  it("detects raw HTTP format", () => {
    expect(detectFormat("GET /users HTTP/1.1\nHost: example.com")).toBe(
      "raw-http"
    );
  });

  it("detects raw HTTP with POST", () => {
    expect(detectFormat("POST /users HTTP/1.1\nHost: example.com")).toBe(
      "raw-http"
    );
  });

  it("returns unknown for unrecognized input", () => {
    expect(detectFormat("just some random text")).toBe("unknown");
  });
});
