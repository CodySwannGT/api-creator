import type {
  HarEntry,
  HarHeader,
  HarRequest,
  HarResponse,
} from "../types/har.js";

/** Regex to match the first line of a raw HTTP request block. */
const REQUEST_LINE_RE =
  /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)(?:\s+(HTTP\/\S+))?/;

/** Header name used for content-type lookups. */
const CONTENT_TYPE_HEADER = "content-type";

/**
 * Build a default HAR response with zero-filled fields.
 * @returns a HAR response with empty/zero values
 */
function makeDefaultResponse(): HarResponse {
  return {
    status: 0,
    statusText: "",
    httpVersion: "HTTP/1.1",
    headers: [],
    content: { size: 0, mimeType: "" },
    redirectURL: "",
    headersSize: -1,
    bodySize: -1,
    cookies: [],
  };
}

/**
 * Wrap a request into a HAR entry with a default response.
 * @param request - the HAR request to wrap
 * @returns a HAR entry containing the request and a default response
 */
function makeEntry(request: HarRequest): HarEntry {
  return {
    startedDateTime: new Date().toISOString(),
    time: 0,
    request,
    response: makeDefaultResponse(),
  };
}

/**
 * Parse query string from a URL into name/value pairs.
 * @param url - the full URL to parse
 * @returns an array of name/value query parameter objects
 */
function parseQueryString(url: string): { name: string; value: string }[] {
  try {
    return Array.from(new URL(url).searchParams.entries()).map(
      ([name, value]) => ({ name, value })
    );
  } catch {
    return [];
  }
}

/**
 * Infer the MIME type of a request body from its content.
 * @param body - the raw body string to inspect
 * @returns the inferred MIME type string
 */
function inferMimeType(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("["))
    return "application/json";
  if (trimmed.includes("=") && !trimmed.includes("<"))
    return "application/x-www-form-urlencoded";
  return "text/plain";
}

/**
 * Attach postData to a request if a body is present.
 * @param request - the HAR request to enrich
 * @param body - the raw body string, or undefined
 * @returns the request with postData attached or unchanged if no body
 */
function attachPostData(
  request: HarRequest,
  body: string | undefined
): HarRequest {
  if (!body) return request;
  const mimeType =
    request.headers.find(h => h.name.toLowerCase() === CONTENT_TYPE_HEADER)
      ?.value ?? inferMimeType(body);
  return { ...request, postData: { mimeType, text: body } };
}

/**
 * Parse a single raw HTTP request block into a HAR entry.
 * Returns null if the block does not start with a valid HTTP request line.
 * @param block - a raw HTTP request block as a string
 * @returns the HAR entry, or null if the block is not a valid request
 */
export function parseSingleRawHttp(block: string): HarEntry | null {
  const lines = block.split("\n");
  if (lines.length === 0) return null;
  const reqMatch = REQUEST_LINE_RE.exec(lines[0].trim());
  if (!reqMatch) return null;

  const method = reqMatch[1];
  const path = reqMatch[2];
  const httpVersion = reqMatch[3] ?? "HTTP/1.1";

  const emptyIdx = lines.slice(1).findIndex(l => l.trim() === "");
  const headerLines =
    emptyIdx === -1 ? lines.slice(1) : lines.slice(1, emptyIdx + 1);
  const headers = headerLines
    .map(l => ({ idx: l.indexOf(":"), l }))
    .filter(({ idx }) => idx !== -1)
    .map(
      ({ idx, l }): HarHeader => ({
        name: l.slice(0, idx).trim(),
        value: l.slice(idx + 1).trim(),
      })
    );

  const body =
    emptyIdx !== -1
      ? lines
          .slice(emptyIdx + 2)
          .join("\n")
          .trim() || undefined
      : undefined;
  const hostHeader = headers.find(h => h.name.toLowerCase() === "host");
  const url =
    !path.startsWith("http") && hostHeader
      ? `https://${hostHeader.value}${path}`
      : path;

  const base: HarRequest = {
    method,
    url,
    httpVersion,
    headers,
    queryString: parseQueryString(url),
    headersSize: -1,
    bodySize: body ? body.length : 0,
    cookies: [],
  };
  return makeEntry(attachPostData(base, body));
}

/**
 * Parse a string containing one or more raw HTTP requests into HAR entries.
 * @param input - raw text containing HTTP request(s)
 * @returns an array of HAR entries, one per request block found
 */
export function parseRawHttp(input: string): HarEntry[] {
  const blocks = input.split(
    /\n(?=(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s)/
  );
  return blocks
    .map(parseSingleRawHttp)
    .filter((e): e is HarEntry => e !== null);
}

/**
 * Parse a JSON HAR string and return its entries array.
 * Returns an empty array if the input is not valid HAR JSON.
 * @param input - a JSON string that may contain a HAR log
 * @returns the HAR entries array, or an empty array on failure
 */
export function parseHar(input: string): HarEntry[] {
  try {
    const parsed = JSON.parse(input);
    if (parsed?.log?.entries && Array.isArray(parsed.log.entries)) {
      return parsed.log.entries as HarEntry[];
    }
  } catch {
    // Invalid JSON
  }
  return [];
}
