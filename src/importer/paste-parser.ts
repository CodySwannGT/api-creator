import type {
  HarEntry,
  HarHeader,
  HarRequest,
  HarResponse,
} from "../types/har.js";
import { parseRawHttp, parseHar } from "./paste-parser-http.js";

/** Header name used for content-type lookups across all parsers. */
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
 * Wrap a parsed request into a HAR entry with a default response.
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
 * Parse the query string from a URL into name/value pairs.
 * Returns an empty array if the URL is unparseable.
 * @param url - the full URL to parse query params from
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
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "application/json";
  }
  if (trimmed.includes("=") && !trimmed.includes("<")) {
    return "application/x-www-form-urlencoded";
  }
  return "text/plain";
}

/**
 * Attach postData to a request object if a body is present.
 * @param request - the HAR request to enrich
 * @param body - the raw body string, or undefined
 * @returns the request with postData attached (or unchanged if no body)
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
 * Split a multi-command cURL input string into individual command strings.
 * Handles backslash line continuation.
 * @param input - raw text potentially containing multiple curl commands
 * @returns an array of individual curl command strings
 */
function splitCurlCommands(input: string): string[] {
  const joined = input.replace(/\\\s*\n/g, " ");
  return joined.split("\n").reduce<string[]>((acc, line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("curl ")) {
      return [...acc, trimmed];
    }
    if (acc.length > 0 && trimmed) {
      return [...acc.slice(0, -1), `${acc[acc.length - 1]} ${trimmed}`];
    }
    return acc;
  }, []);
}

/** State passed through the cURL tokenizer character loop. */
type TokenizerState = {
  tokens: readonly string[];
  current: string;
  inSingle: boolean;
  inDouble: boolean;
  escaped: boolean;
};

/**
 * Flush the current token accumulator into the tokens list if non-empty.
 * Called when unquoted whitespace is encountered during tokenization.
 * @param state - current tokenizer state
 * @returns updated state with token flushed, or unchanged if accumulator is empty
 */
function flushToken(state: TokenizerState): TokenizerState {
  return state.current.length > 0
    ? { ...state, tokens: [...state.tokens, state.current], current: "" }
    : state;
}

/**
 * Process a single character in the cURL tokenizer, returning updated state.
 * @param state - current tokenizer state
 * @param ch - the character being processed
 * @returns the updated tokenizer state
 */
function processTokenizerChar(
  state: TokenizerState,
  ch: string
): TokenizerState {
  if (state.escaped)
    return { ...state, current: state.current + ch, escaped: false };
  if (ch === "\\" && !state.inSingle) return { ...state, escaped: true };
  if (ch === "'" && !state.inDouble)
    return { ...state, inSingle: !state.inSingle };
  if (ch === '"' && !state.inSingle)
    return { ...state, inDouble: !state.inDouble };
  if ((ch === " " || ch === "\t") && !state.inSingle && !state.inDouble)
    return flushToken(state);
  return { ...state, current: state.current + ch };
}

/**
 * Tokenize a single cURL command string into an array of argument tokens.
 * Handles single-quoted, double-quoted, and escaped characters.
 * @param command - a full curl command string starting with "curl "
 * @returns the list of parsed argument tokens
 */
function tokenizeCurl(command: string): readonly string[] {
  const input = command.replace(/^\s*curl\s+/, "");
  const s = [...input].reduce<TokenizerState>(processTokenizerChar, {
    tokens: [],
    current: "",
    inSingle: false,
    inDouble: false,
    escaped: false,
  });
  return s.current.length > 0 ? [...s.tokens, s.current] : s.tokens;
}

/** Accumulated curl parse state passed through token iteration. */
type CurlParseState = {
  method: string;
  url: string;
  headers: readonly HarHeader[];
  body: string | undefined;
  skipNext: boolean;
};

/** Result type returned by applyCurlToken and its helpers. */
type TokenResult = { state: CurlParseState; consumed: boolean };

/**
 * Handle curl data-body flags (-d, --data, --data-raw, --data-binary).
 * @param state - the current parse state
 * @param body - the body value (next token for long flags, or inline for -d)
 * @param consumed - whether the next token was consumed as the body value
 * @returns updated state with body set and method promoted from GET to POST
 */
function applyDataToken(
  state: CurlParseState,
  body: string | undefined,
  consumed: boolean
): TokenResult {
  const method = state.method === "GET" ? "POST" : state.method;
  return { state: { ...state, body, method }, consumed };
}

/**
 * Apply a single token (and optionally the next) to the curl parse state.
 * @param state - the current parse state
 * @param token - the current token
 * @param next - the following token, if any
 * @returns the updated state and whether the next token was consumed
 */
function applyCurlToken(
  state: CurlParseState,
  token: string,
  next: string | undefined
): TokenResult {
  if (token === "-X" || token === "--request") {
    return {
      state: { ...state, method: next?.toUpperCase() ?? state.method },
      consumed: true,
    };
  }
  if (token === "-H" || token === "--header") {
    const idx = next?.indexOf(":") ?? -1;
    if (next && idx !== -1) {
      const header: HarHeader = {
        name: next.slice(0, idx).trim(),
        value: next.slice(idx + 1).trim(),
      };
      return {
        state: { ...state, headers: [...state.headers, header] },
        consumed: true,
      };
    }
    return { state, consumed: true };
  }
  if (
    token === "-d" ||
    token === "--data" ||
    token === "--data-raw" ||
    token === "--data-binary"
  ) {
    return applyDataToken(state, next, true);
  }
  if (token.startsWith("-d"))
    return applyDataToken(state, token.slice(2), false);
  if (token === "--url")
    return { state: { ...state, url: next ?? state.url }, consumed: true };
  if (!token.startsWith("-") && !state.url)
    return { state: { ...state, url: token }, consumed: false };
  return { state, consumed: false };
}

/**
 * Parse a single cURL command string into a HAR entry.
 * @param command - a full curl command string
 * @returns the HAR entry representing this request
 */
function parseSingleCurl(command: string): HarEntry {
  const tokens = tokenizeCurl(command);
  const parsed = [...tokens].reduce<CurlParseState>(
    (state, token, idx) => {
      if (state.skipNext) return { ...state, skipNext: false };
      const { state: next, consumed } = applyCurlToken(
        state,
        token,
        tokens[idx + 1]
      );
      return { ...next, skipNext: consumed };
    },
    { method: "GET", url: "", headers: [], body: undefined, skipNext: false }
  );

  const base: HarRequest = {
    method: parsed.method,
    url: parsed.url,
    httpVersion: "HTTP/1.1",
    headers: [...parsed.headers],
    queryString: parseQueryString(parsed.url),
    headersSize: -1,
    bodySize: parsed.body ? parsed.body.length : 0,
    cookies: [],
  };
  return makeEntry(attachPostData(base, parsed.body));
}

/**
 * Parse a string containing one or more cURL commands into HAR entries.
 * @param input - raw text containing curl command(s)
 * @returns an array of HAR entries, one per curl command found
 */
function parseCurl(input: string): HarEntry[] {
  return splitCurlCommands(input).map(parseSingleCurl);
}

// --- fetch() Parser ---

/** Regex to match fetch() calls — captures args up to first unmatched ")". */
const FETCH_CALL_RE = /fetch\s*\(([^)]*)\)/g;
/** Regex to extract the method from a fetch options object. */
const FETCH_METHOD_RE = /method\s*:\s*["'`](\w+)["'`]/;
/** Regex to extract a headers block from a fetch options object. */
const FETCH_HEADERS_BLOCK_RE = /headers\s*:\s*\{([^}]*)\}/s;
/** Regex to extract a body string literal from a fetch options object. */
const FETCH_BODY_LITERAL_RE = /body\s*:\s*["'`]([^"'`]*)["'`]/;
/** Regex to extract a JSON.stringify body call from a fetch options object. */
const FETCH_BODY_STRINGIFY_RE = /body\s*:\s*JSON\.stringify\s*\(([^)]*)\)/;
/** Regex to extract quoted header key/value pairs from a headers block. */
const FETCH_HEADER_PAIR_RE =
  /["'`]([^"'`:\s,]+)["'`]\s*:\s*["'`]([^"'`]*)["'`]/g;

/**
 * Parse a single fetch() call's argument string into a HAR entry.
 * Returns null if the URL argument cannot be extracted.
 * @param argsStr - the raw argument string from inside fetch(...)
 * @returns a HAR entry, or null if parsing fails
 */
function parseSingleFetch(argsStr: string): HarEntry | null {
  const trimmed = argsStr.trim();
  const quote = trimmed[0];
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;
  const endIdx = trimmed.indexOf(quote, 1);
  if (endIdx === -1) return null;
  const url = trimmed.slice(1, endIdx);
  const rest = trimmed
    .slice(endIdx + 1)
    .replace(/^\s*,\s*/, "")
    .trim();

  const hasOpts = rest.startsWith("{");
  const method = hasOpts
    ? (FETCH_METHOD_RE.exec(rest)?.[1]?.toUpperCase() ?? "GET")
    : "GET";
  const headers = hasOpts
    ? Array.from(
        (FETCH_HEADERS_BLOCK_RE.exec(rest)?.[1] ?? "").matchAll(
          FETCH_HEADER_PAIR_RE
        )
      ).map(m => ({ name: m[1], value: m[2] }) as HarHeader)
    : [];
  const body = hasOpts
    ? (FETCH_BODY_LITERAL_RE.exec(rest)?.[1] ??
      FETCH_BODY_STRINGIFY_RE.exec(rest)?.[1])
    : undefined;

  const base: HarRequest = {
    method,
    url,
    httpVersion: "HTTP/1.1",
    headers,
    queryString: parseQueryString(url),
    headersSize: -1,
    bodySize: body ? body.length : 0,
    cookies: [],
  };
  return makeEntry(attachPostData(base, body));
}

/**
 * Parse a string containing one or more fetch() calls into HAR entries.
 * @param input - raw text containing fetch() call(s)
 * @returns an array of HAR entries, one per fetch() call found
 */
function parseFetch(input: string): HarEntry[] {
  return [...input.matchAll(FETCH_CALL_RE)]
    .map(m => parseSingleFetch(m[1]))
    .filter((e): e is HarEntry => e !== null);
}

/**
 * Parse a pasted input string in the given format into an array of HAR entries.
 * Supports curl, fetch, raw-http, and har formats.
 * @param input - the raw text pasted by the user
 * @param format - the detected or specified input format
 * @returns an array of HAR entries extracted from the input
 */
export function parseInput(input: string, format: string): HarEntry[] {
  switch (format) {
    case "curl":
      return parseCurl(input);
    case "fetch":
      return parseFetch(input);
    case "raw-http":
      return parseRawHttp(input);
    case "har":
      return parseHar(input);
    default:
      return [];
  }
}
