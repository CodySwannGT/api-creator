import type { HarEntry } from '../types/har.js';
import type {
  Endpoint,
  EndpointGroup,
  QueryParamInfo,
} from '../types/endpoint.js';
import { normalizePath } from '../utils/url-pattern.js';

/** Matches long hex hash strings (32+ hex chars) used as GraphQL persisted query hashes. */
const HEX_HASH_RE = /^[0-9a-f]{32,}$/i;

/**
 * For Airbnb-style persisted GraphQL queries like `/api/v3/OperationName/<hash>`,
 * drop the hash segment so all requests to the same operation group together.
 */
function collapseGraphqlHash(pathname: string): string {
  const segments = pathname.split('/');
  // If the last segment is a long hex hash, remove it
  if (segments.length >= 2) {
    const last = segments[segments.length - 1];
    if (last && HEX_HASH_RE.test(last)) {
      segments.pop();
      return segments.join('/');
    }
  }
  return pathname;
}

/**
 * Extract the base URL (scheme + host) from the first entry,
 * or find the most common one across all entries.
 */
function extractBaseUrl(entries: HarEntry[]): string {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    try {
      const url = new URL(entry.request.url);
      const base = `${url.protocol}//${url.host}`;
      counts.set(base, (counts.get(base) ?? 0) + 1);
    } catch {
      // skip unparseable URLs
    }
  }

  let best = '';
  let bestCount = 0;
  for (const [base, count] of counts) {
    if (count > bestCount) {
      best = base;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Try to parse a JSON string, returning undefined on failure.
 */
function tryParseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Group HAR entries into endpoints by {method, normalizedPath}.
 */
export function groupEndpoints(entries: HarEntry[]): EndpointGroup {
  const baseUrl = extractBaseUrl(entries);

  // Group key → collected data
  const groups = new Map<
    string,
    {
      method: string;
      normalizedPath: string;
      originalUrls: string[];
      queryParams: Map<string, string[]>;
      requestBodies: unknown[];
      responseBodies: unknown[];
      responseStatuses: number[];
      headers: Record<string, string>;
      entryCount: number;
    }
  >();

  for (const entry of entries) {
    let pathname: string;
    try {
      const url = new URL(entry.request.url);
      pathname = url.pathname;
    } catch {
      continue;
    }

    const method = entry.request.method.toUpperCase();
    pathname = collapseGraphqlHash(pathname);
    const normalized = normalizePath(pathname);
    const groupKey = `${method}:${normalized}`;

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        method,
        normalizedPath: normalized,
        originalUrls: [],
        queryParams: new Map(),
        requestBodies: [],
        responseBodies: [],
        responseStatuses: [],
        headers: {},
        entryCount: 0,
      };
      groups.set(groupKey, group);
    }

    group.entryCount++;
    group.originalUrls.push(entry.request.url);

    // Collect query params
    for (const param of entry.request.queryString) {
      let values = group.queryParams.get(param.name);
      if (!values) {
        values = [];
        group.queryParams.set(param.name, values);
      }
      values.push(param.value);
    }

    // Collect request body
    if (entry.request.postData?.text) {
      const parsed = tryParseJson(entry.request.postData.text);
      if (parsed !== undefined) {
        group.requestBodies.push(parsed);
      }
    }

    // Collect response body
    if (entry.response.content.text) {
      const parsed = tryParseJson(entry.response.content.text);
      if (parsed !== undefined) {
        group.responseBodies.push(parsed);
      }
    }

    // Collect response status
    group.responseStatuses.push(entry.response.status);

    // Collect common headers (first seen wins)
    for (const header of entry.request.headers) {
      const lc = header.name.toLowerCase();
      if (
        lc === 'content-type' ||
        lc === 'accept' ||
        lc === 'authorization'
      ) {
        if (!(header.name in group.headers)) {
          group.headers[header.name] = header.value;
        }
      }
    }
  }

  // Convert groups to Endpoint[]
  const endpoints: Endpoint[] = [];

  for (const group of groups.values()) {
    const queryParams: QueryParamInfo[] = [];

    for (const [name, values] of group.queryParams) {
      queryParams.push({
        name,
        observedValues: [...new Set(values)],
        required: values.length === group.entryCount,
      });
    }

    endpoints.push({
      method: group.method,
      normalizedPath: group.normalizedPath,
      originalUrls: group.originalUrls,
      queryParams,
      requestBodies: group.requestBodies,
      responseBodies: group.responseBodies,
      responseStatuses: group.responseStatuses,
      headers: group.headers,
    });
  }

  return { baseUrl, endpoints };
}
