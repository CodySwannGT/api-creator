/**
 * Shared cURL auth parsing logic.
 * Extracted from the previously generated CLI project emitter.
 */

/**
 * Authentication configuration extracted from a cURL command or browser capture.
 * At least one of cookie, token, or apiKey must be set for auth to be valid.
 */
export interface AuthConfig {
  cookie?: string;
  token?: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
}

/**
 * Parse auth credentials from a cURL command string.
 * Handles backslash line continuations, -b cookies, -H Cookie headers,
 * Authorization Bearer tokens, and x-* extra headers.
 * @param input - a cURL command string, potentially with backslash-continued lines
 * @returns the parsed AuthConfig, or null if no valid auth was found
 */
export function parseAuthFromCurl(input: string): AuthConfig | null {
  const joined = input.trim().replace(/\\\s*\n/g, " ");

  if (!/^curl\s/i.test(joined)) return null;

  const bMatch = /-b\s+'([^']+)'/.exec(joined) ?? /-b\s+"([^"]+)"/.exec(joined);

  const {
    cookie: headerCookie,
    token,
    extraHeaders,
  } = extractAllHeaderAuth(joined);

  const cookie = bMatch ? bMatch[1] : headerCookie;

  if (!cookie && !token) return null;

  return {
    ...(cookie ? { cookie } : {}),
    ...(token ? { token } : {}),
    ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
  };
}

/**
 * Classifies a single header into cookie, token, or extra header
 * @param hName - the header name
 * @param hValue - the header value
 * @returns an object indicating the classification
 */
function classifyHeader(
  hName: string,
  hValue: string
): { cookie?: string; token?: string; extraHeader?: [string, string] } {
  const hLower = hName.toLowerCase();

  if (hLower === "cookie") {
    return { cookie: hValue };
  }
  if (
    hLower === "authorization" &&
    hValue.toLowerCase().startsWith("bearer ")
  ) {
    return { token: hValue.replace(/^[Bb]earer\s+/, "") };
  }
  if (
    hLower.startsWith("x-") &&
    hValue &&
    !hLower.startsWith("x-client-") &&
    hLower !== "x-csrf-without-token"
  ) {
    return { extraHeader: [hName, hValue] };
  }
  return {};
}

/**
 * Extracts cookie, bearer token, and x-* headers from -H flags in a joined cURL string.
 * @param joined - the joined (no line continuations) cURL string
 * @returns an object with cookie, token, and extraHeaders values
 */
function extractAllHeaderAuth(joined: string): {
  cookie: string | undefined;
  token: string | undefined;
  extraHeaders: Record<string, string>;
} {
  const headerPattern = /-H\s+'([^']*)'|-H\s+"([^"]*)"/g;
  const matches = [...joined.matchAll(headerPattern)];

  return matches.reduce<{
    cookie: string | undefined;
    token: string | undefined;
    extraHeaders: Record<string, string>;
  }>(
    (acc, hm) => {
      const headerStr = hm[1] ?? hm[2];
      const colonIdx = headerStr.indexOf(":");
      if (colonIdx === -1) return acc;

      const hName = headerStr.slice(0, colonIdx).trim();
      const hValue = headerStr.slice(colonIdx + 1).trim();
      const classified = classifyHeader(hName, hValue);

      return {
        cookie: classified.cookie ?? acc.cookie,
        token: classified.token ?? acc.token,
        extraHeaders: classified.extraHeader
          ? {
              ...acc.extraHeaders,
              [classified.extraHeader[0]]: classified.extraHeader[1],
            }
          : acc.extraHeaders,
      };
    },
    { cookie: undefined, token: undefined, extraHeaders: {} }
  );
}
