import type { HarEntry } from '../types/har.js';
import type { AuthInfo } from '../types/auth.js';

const AUTH_COOKIE_NAMES = new Set([
  'session',
  'token',
  'sid',
  'jwt',
  'auth',
  'sess',
  '_session',
]);

const CUSTOM_AUTH_HEADERS: Record<string, boolean> = {
  'x-api-key': true,
  'x-auth-token': true,
};

const AUTH_QUERY_PARAMS = new Set([
  'api_key',
  'token',
  'access_token',
  'key',
]);

interface AuthCandidate {
  info: AuthInfo;
  count: number;
}

/**
 * Detect authentication patterns across all HAR entries.
 * Returns deduplicated results sorted by confidence descending.
 */
export function detectAuth(entries: HarEntry[]): AuthInfo[] {
  // Map from a dedup key to {info, count}
  const seen = new Map<string, AuthCandidate>();

  function track(info: AuthInfo): void {
    const key = `${info.type}:${info.location}:${info.key}:${info.value}`;
    const existing = seen.get(key);
    if (existing) {
      existing.count++;
    } else {
      seen.set(key, { info, count: 1 });
    }
  }

  for (const entry of entries) {
    const { request } = entry;

    // Check Authorization headers
    for (const header of request.headers) {
      const name = header.name.toLowerCase();

      if (name === 'authorization') {
        const value = header.value.trim();

        if (value.toLowerCase().startsWith('bearer ')) {
          track({
            type: 'bearer',
            location: 'header',
            key: 'Authorization',
            value,
            confidence: 1.0,
          });
        } else if (value.toLowerCase().startsWith('basic ')) {
          track({
            type: 'bearer',
            location: 'header',
            key: 'Authorization',
            value,
            confidence: 0.9,
          });
        }
      }

      // Check custom auth headers
      if (CUSTOM_AUTH_HEADERS[name]) {
        track({
          type: 'api-key',
          location: 'header',
          key: header.name,
          value: header.value,
          confidence: 0.7,
        });
      }
    }

    // Check cookies
    for (const cookie of request.cookies) {
      if (AUTH_COOKIE_NAMES.has(cookie.name.toLowerCase())) {
        track({
          type: 'cookie',
          location: 'cookie',
          key: cookie.name,
          value: cookie.value,
          confidence: 0.8,
        });
      }
    }

    // Check query params
    for (const param of request.queryString) {
      if (AUTH_QUERY_PARAMS.has(param.name.toLowerCase())) {
        track({
          type: 'query-param',
          location: 'query',
          key: param.name,
          value: param.value,
          confidence: 0.6,
        });
      }
    }
  }

  // If most requests have a Cookie header, treat that as cookie auth
  // (many sites use non-standard cookie names)
  let cookieHeaderCount = 0;
  let cookieHeaderValue = '';
  for (const entry of entries) {
    for (const header of entry.request.headers) {
      if (header.name.toLowerCase() === 'cookie' && header.value.length > 0) {
        cookieHeaderCount++;
        if (header.value.length > cookieHeaderValue.length) {
          cookieHeaderValue = header.value;
        }
      }
    }
  }
  if (cookieHeaderCount > entries.length * 0.5 && cookieHeaderValue) {
    const key = `cookie:cookie:Cookie:${cookieHeaderValue}`;
    if (!seen.has(key)) {
      seen.set(key, {
        info: {
          type: 'cookie',
          location: 'cookie',
          key: 'Cookie',
          value: '(full cookie header)',
          confidence: 0.85,
        },
        count: cookieHeaderCount,
      });
    }
  }

  // Deduplicate by value: for the same auth value, keep the one with highest confidence
  // and the highest count
  const byValue = new Map<string, AuthCandidate>();
  for (const candidate of seen.values()) {
    const vKey = candidate.info.value;
    const existing = byValue.get(vKey);
    if (!existing) {
      byValue.set(vKey, candidate);
    } else if (candidate.info.confidence > existing.info.confidence) {
      byValue.set(vKey, candidate);
    } else if (
      candidate.info.confidence === existing.info.confidence &&
      candidate.count > existing.count
    ) {
      byValue.set(vKey, candidate);
    }
  }

  // Sort by confidence descending, then by count descending for ties
  const results = Array.from(byValue.values());
  results.sort((a, b) => {
    if (b.info.confidence !== a.info.confidence) {
      return b.info.confidence - a.info.confidence;
    }
    return b.count - a.count;
  });

  return results.map((r) => r.info);
}
