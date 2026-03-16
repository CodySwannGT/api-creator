/**
 * Shared cURL auth parsing logic.
 * Extracted from the previously generated CLI project emitter.
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
 */
export function parseAuthFromCurl(input: string): AuthConfig | null {
  const trimmed = input.trim();

  // Join backslash-continued lines
  const joined = trimmed.replace(/\\\s*\n/g, ' ');

  // Check if it looks like a cURL command
  const isCurl = /^curl\s/i.test(joined);
  if (!isCurl) return null;

  const auth: AuthConfig = {};

  // Extract cookie from -b flag
  const bMatch = joined.match(/-b\s+'([^']+)'/) || joined.match(/-b\s+"([^"]+)"/);
  if (bMatch) auth.cookie = bMatch[1];

  // Extract all -H headers
  const headerPattern = /-H\s+'([^']*)'|-H\s+"([^"]*)"/g;
  const extraHeaders: Record<string, string> = {};
  let hm;
  while ((hm = headerPattern.exec(joined)) !== null) {
    const headerStr = hm[1] || hm[2];
    const colonIdx = headerStr.indexOf(':');
    if (colonIdx === -1) continue;
    const hName = headerStr.slice(0, colonIdx).trim();
    const hValue = headerStr.slice(colonIdx + 1).trim();
    const hLower = hName.toLowerCase();

    // Cookie header
    if (hLower === 'cookie') {
      auth.cookie = hValue;
      continue;
    }
    // Bearer token
    if (hLower === 'authorization' && hValue.toLowerCase().startsWith('bearer ')) {
      auth.token = hValue.replace(/^[Bb]earer\s+/, '');
      continue;
    }
    // Interesting extra headers to preserve
    if (
      hLower.startsWith('x-') &&
      hValue &&
      !hLower.startsWith('x-client-') &&
      hLower !== 'x-csrf-without-token'
    ) {
      extraHeaders[hName] = hValue;
    }
  }

  if (Object.keys(extraHeaders).length > 0) auth.extraHeaders = extraHeaders;
  if (!auth.cookie && !auth.token && !auth.apiKey) return null;
  return auth;
}
