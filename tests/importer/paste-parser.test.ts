import { describe, it, expect } from "vitest";
import { parseInput } from "../../src/importer/paste-parser.js";

describe("parseInput", () => {
  describe("cURL parsing", () => {
    it("parses a simple GET cURL", () => {
      const input = `curl 'https://api.example.com/users'`;
      const entries = parseInput(input, "curl");
      expect(entries).toHaveLength(1);
      expect(entries[0].request.method).toBe("GET");
      expect(entries[0].request.url).toBe("https://api.example.com/users");
    });

    it("parses a POST cURL with headers and body", () => {
      const input = `curl -X POST 'https://api.example.com/users' -H 'Content-Type: application/json' -H 'Authorization: Bearer tok123' -d '{"name":"Alice"}'`;
      const entries = parseInput(input, "curl");
      expect(entries).toHaveLength(1);
      expect(entries[0].request.method).toBe("POST");
      expect(entries[0].request.headers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Content-Type",
            value: "application/json",
          }),
          expect.objectContaining({
            name: "Authorization",
            value: "Bearer tok123",
          }),
        ])
      );
      expect(entries[0].request.postData?.text).toBe('{"name":"Alice"}');
    });

    it("infers POST method when -d is used without -X", () => {
      const input = `curl 'https://api.example.com/data' -d '{"key":"value"}'`;
      const entries = parseInput(input, "curl");
      expect(entries).toHaveLength(1);
      expect(entries[0].request.method).toBe("POST");
    });
  });

  describe("fetch() parsing", () => {
    it("parses a simple fetch GET", () => {
      const input = `fetch('https://api.example.com/users');`;
      const entries = parseInput(input, "fetch");
      expect(entries).toHaveLength(1);
      expect(entries[0].request.method).toBe("GET");
      expect(entries[0].request.url).toBe("https://api.example.com/users");
    });

    it("parses a fetch POST with options", () => {
      const input = `fetch('https://api.example.com/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer tok456'
  },
  body: 'hello-world'
});`;
      const entries = parseInput(input, "fetch");
      expect(entries).toHaveLength(1);
      expect(entries[0].request.method).toBe("POST");
      expect(entries[0].request.postData?.text).toBe("hello-world");
      expect(entries[0].request.headers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Content-Type",
            value: "application/json",
          }),
          expect.objectContaining({
            name: "Authorization",
            value: "Bearer tok456",
          }),
        ])
      );
    });
  });

  describe("raw HTTP parsing", () => {
    it("parses a raw HTTP GET request", () => {
      const input = `GET /users HTTP/1.1
Host: api.example.com
Accept: application/json`;
      const entries = parseInput(input, "raw-http");
      expect(entries).toHaveLength(1);
      expect(entries[0].request.method).toBe("GET");
      expect(entries[0].request.url).toBe("https://api.example.com/users");
    });

    it("parses a raw HTTP POST with body", () => {
      const input = `POST /users HTTP/1.1
Host: api.example.com
Content-Type: application/json

{"name":"Charlie"}`;
      const entries = parseInput(input, "raw-http");
      expect(entries).toHaveLength(1);
      expect(entries[0].request.method).toBe("POST");
      expect(entries[0].request.postData?.text).toBe('{"name":"Charlie"}');
    });
  });

  describe("HAR pass-through", () => {
    it("parses valid HAR JSON and returns entries", () => {
      const har = JSON.stringify({
        log: {
          version: "1.2",
          creator: { name: "test", version: "1.0" },
          entries: [
            {
              startedDateTime: "2026-01-01T00:00:00Z",
              time: 0,
              request: {
                method: "GET",
                url: "https://api.example.com/test",
                httpVersion: "HTTP/1.1",
                headers: [],
                queryString: [],
                headersSize: -1,
                bodySize: 0,
                cookies: [],
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
            },
          ],
        },
      });
      const entries = parseInput(har, "har");
      expect(entries).toHaveLength(1);
      expect(entries[0].request.method).toBe("GET");
    });

    it("returns empty array for invalid HAR", () => {
      const entries = parseInput("not json", "har");
      expect(entries).toEqual([]);
    });
  });

  it("returns empty array for unknown format", () => {
    const entries = parseInput("something", "unknown");
    expect(entries).toEqual([]);
  });
});
