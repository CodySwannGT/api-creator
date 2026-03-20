import type { HarEntry } from "../types/har.js";
import type { AuthInfo } from "../types/auth.js";

const AUTH_COOKIE_NAMES = new Set([
  "session",
  "token",
  "sid",
  "jwt",
  "auth",
  "sess",
  "_session",
]);

const CUSTOM_AUTH_HEADERS: Record<string, boolean> = {
  "x-api-key": true,
  "x-auth-token": true,
};

const AUTH_QUERY_PARAMS = new Set(["api_key", "token", "access_token", "key"]);

/**
 * Tracks a deduplicated auth candidate with its observation count
 */
interface AuthCandidate {
  info: AuthInfo;
  count: number;
}

/**
 * Builds a dedup key for an AuthInfo to prevent duplicate tracking
 * @param info - the auth info to build a key for
 * @returns a string key combining type, location, key, and value
 */
function authKey(info: AuthInfo): string {
  return `${info.type}:${info.location}:${info.key}:${info.value}`;
}

/**
 * Extracts auth candidates from a single entry's headers
 * @param headers - the request headers to scan
 * @returns array of AuthInfo found in headers
 */
function extractHeaderAuth(
  headers: { name: string; value: string }[]
): AuthInfo[] {
  return headers.flatMap((header): AuthInfo[] => {
    const name = header.name.toLowerCase();

    if (name === "authorization") {
      const value = header.value.trim();
      if (
        value.toLowerCase().startsWith("bearer ") ||
        value.toLowerCase().startsWith("basic ")
      ) {
        const confidence = value.toLowerCase().startsWith("bearer ")
          ? 1.0
          : 0.9;
        return [
          {
            type: "bearer",
            location: "header",
            key: "Authorization",
            value,
            confidence,
          },
        ];
      }
    }

    if (CUSTOM_AUTH_HEADERS[name]) {
      return [
        {
          type: "api-key",
          location: "header",
          key: header.name,
          value: header.value,
          confidence: 0.7,
        },
      ];
    }

    return [];
  });
}

/**
 * Extracts auth candidates from a single entry's cookies
 * @param cookies - the request cookies to scan
 * @returns array of AuthInfo found in cookies
 */
function extractCookieAuth(
  cookies: { name: string; value: string }[]
): AuthInfo[] {
  return cookies.flatMap(cookie =>
    AUTH_COOKIE_NAMES.has(cookie.name.toLowerCase())
      ? [
          {
            type: "cookie" as const,
            location: "cookie" as const,
            key: cookie.name,
            value: cookie.value,
            confidence: 0.8,
          },
        ]
      : []
  );
}

/**
 * Extracts auth candidates from a single entry's query params
 * @param queryString - the request query string params to scan
 * @returns array of AuthInfo found in query params
 */
function extractQueryAuth(
  queryString: { name: string; value: string }[]
): AuthInfo[] {
  return queryString.flatMap(param =>
    AUTH_QUERY_PARAMS.has(param.name.toLowerCase())
      ? [
          {
            type: "query-param" as const,
            location: "query" as const,
            key: param.name,
            value: param.value,
            confidence: 0.6,
          },
        ]
      : []
  );
}

/**
 * Collects all auth candidates from all entries into a deduped map
 * @param entries - the HAR entries to scan for auth patterns
 * @returns a map of dedup keys to auth candidates with counts
 */
function collectCandidates(entries: HarEntry[]): Map<string, AuthCandidate> {
  return entries.reduce<Map<string, AuthCandidate>>((seen, entry) => {
    const { request } = entry;
    const allInfos = [
      ...extractHeaderAuth(request.headers),
      ...extractCookieAuth(request.cookies),
      ...extractQueryAuth(request.queryString),
    ];

    return allInfos.reduce((map, info) => {
      const key = authKey(info);
      const existing = map.get(key);
      const entry: [string, AuthCandidate] = [
        key,
        existing
          ? { info: existing.info, count: existing.count + 1 }
          : { info, count: 1 },
      ];
      return new Map([...map, entry]);
    }, seen);
  }, new Map());
}

/**
 * Detects if most entries use a Cookie header and adds a generic cookie auth candidate
 * @param entries - the HAR entries to check
 * @param seen - the existing candidates map
 * @returns updated candidates map with cookie header candidate if applicable
 */
function detectCookieHeaderAuth(
  entries: HarEntry[],
  seen: Map<string, AuthCandidate>
): Map<string, AuthCandidate> {
  const cookieStats = entries.reduce<{ count: number; longestValue: string }>(
    (acc, entry) => {
      const cookieHeader = entry.request.headers.find(
        h => h.name.toLowerCase() === "cookie" && h.value.length > 0
      );
      if (!cookieHeader) return acc;
      return {
        count: acc.count + 1,
        longestValue:
          cookieHeader.value.length > acc.longestValue.length
            ? cookieHeader.value
            : acc.longestValue,
      };
    },
    { count: 0, longestValue: "" }
  );

  if (cookieStats.count <= entries.length * 0.5 || !cookieStats.longestValue) {
    return seen;
  }

  const key = `cookie:cookie:Cookie:${cookieStats.longestValue}`;
  if (seen.has(key)) return seen;

  const entry: [string, AuthCandidate] = [
    key,
    {
      info: {
        type: "cookie",
        location: "cookie",
        key: "Cookie",
        value: "(full cookie header)",
        confidence: 0.85,
      },
      count: cookieStats.count,
    },
  ];
  return new Map([...seen, entry]);
}

/**
 * Deduplicates candidates by value, keeping the one with highest confidence/count
 * @param candidates - the auth candidates to deduplicate
 * @returns deduplicated map keyed by auth value
 */
function deduplicateByValue(
  candidates: Map<string, AuthCandidate>
): Map<string, AuthCandidate> {
  return [...candidates.values()].reduce<Map<string, AuthCandidate>>(
    (byValue, candidate) => {
      const vKey = candidate.info.value;
      const existing = byValue.get(vKey);
      const shouldReplace =
        !existing ||
        candidate.info.confidence > existing.info.confidence ||
        (candidate.info.confidence === existing.info.confidence &&
          candidate.count > existing.count);
      return shouldReplace ? new Map([...byValue, [vKey, candidate]]) : byValue;
    },
    new Map()
  );
}

/**
 * Detect authentication patterns across all HAR entries.
 * Returns deduplicated results sorted by confidence descending.
 * @param entries - the HAR entries to scan for authentication patterns
 * @returns array of detected auth mechanisms sorted by confidence
 */
export function detectAuth(entries: HarEntry[]): AuthInfo[] {
  const seen = collectCandidates(entries);
  const withCookieHeader = detectCookieHeaderAuth(entries, seen);
  const deduped = deduplicateByValue(withCookieHeader);

  return [...deduped.values()]
    .sort((a, b) =>
      b.info.confidence !== a.info.confidence
        ? b.info.confidence - a.info.confidence
        : b.count - a.count
    )
    .map(r => r.info);
}
