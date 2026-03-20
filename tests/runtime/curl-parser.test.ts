import { describe, it, expect } from "vitest";
import { parseAuthFromCurl } from "../../src/runtime/curl-parser.js";

describe("parseAuthFromCurl", () => {
  it("returns null for non-cURL input", () => {
    expect(parseAuthFromCurl("not a curl command")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseAuthFromCurl("")).toBeNull();
  });

  it("returns null for cURL with no auth headers", () => {
    expect(parseAuthFromCurl("curl https://example.com")).toBeNull();
  });

  it("parses -b cookie flag with single quotes", () => {
    const result = parseAuthFromCurl(
      "curl -b 'session=abc123' https://example.com"
    );
    expect(result).toEqual({ cookie: "session=abc123" });
  });

  it("parses -b cookie flag with double quotes", () => {
    const result = parseAuthFromCurl(
      'curl -b "session=abc123" https://example.com'
    );
    expect(result).toEqual({ cookie: "session=abc123" });
  });

  it("parses -H Cookie header", () => {
    const result = parseAuthFromCurl(
      "curl -H 'Cookie: session=xyz789' https://example.com"
    );
    expect(result).toEqual({ cookie: "session=xyz789" });
  });

  it("parses Authorization Bearer header", () => {
    const result = parseAuthFromCurl(
      "curl -H 'Authorization: Bearer my-token-123' https://example.com"
    );
    expect(result).toEqual({ token: "my-token-123" });
  });

  it("parses Bearer with mixed case", () => {
    const result = parseAuthFromCurl(
      "curl -H 'Authorization: bearer MY_TOKEN' https://example.com"
    );
    expect(result).toEqual({ token: "MY_TOKEN" });
  });

  it("parses x- extra headers", () => {
    const result = parseAuthFromCurl(
      "curl -H 'Cookie: sid=abc' -H 'x-custom-key: val123' https://example.com"
    );
    expect(result).toEqual({
      cookie: "sid=abc",
      extraHeaders: { "x-custom-key": "val123" },
    });
  });

  it("ignores x-client- headers", () => {
    const result = parseAuthFromCurl(
      "curl -H 'Cookie: sid=abc' -H 'x-client-version: 1.0' https://example.com"
    );
    expect(result).toEqual({ cookie: "sid=abc" });
  });

  it("ignores x-csrf-without-token header", () => {
    const result = parseAuthFromCurl(
      "curl -H 'Cookie: sid=abc' -H 'x-csrf-without-token: true' https://example.com"
    );
    expect(result).toEqual({ cookie: "sid=abc" });
  });

  it("handles backslash line continuations", () => {
    const input = `curl \\\n  -H 'Authorization: Bearer tok123' \\\n  https://example.com`;
    const result = parseAuthFromCurl(input);
    expect(result).toEqual({ token: "tok123" });
  });

  it("prefers -b cookie over -H Cookie header", () => {
    const result = parseAuthFromCurl(
      "curl -b 'from-b-flag' -H 'Cookie: from-header' https://example.com"
    );
    expect(result).toEqual({ cookie: "from-b-flag" });
  });

  it("parses both cookie and token together", () => {
    const result = parseAuthFromCurl(
      "curl -H 'Cookie: sid=abc' -H 'Authorization: Bearer tok' https://example.com"
    );
    expect(result).toEqual({ cookie: "sid=abc", token: "tok" });
  });

  it("parses headers with double quotes", () => {
    const result = parseAuthFromCurl(
      'curl -H "Authorization: Bearer dq-token" https://example.com'
    );
    expect(result).toEqual({ token: "dq-token" });
  });

  it("parses multiple x- extra headers", () => {
    const result = parseAuthFromCurl(
      "curl -H 'Cookie: c=1' -H 'x-api-key: key1' -H 'x-request-id: rid2' https://example.com"
    );
    expect(result).toEqual({
      cookie: "c=1",
      extraHeaders: { "x-api-key": "key1", "x-request-id": "rid2" },
    });
  });
});
