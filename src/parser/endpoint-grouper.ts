import type { HarEntry } from "../types/har.js";
import type {
  Endpoint,
  EndpointGroup,
  QueryParamInfo,
} from "../types/endpoint.js";
import { normalizePath } from "../utils/url-pattern.js";

/** Matches long hex hash strings (32+ hex chars) used as GraphQL persisted query hashes. */
const HEX_HASH_RE = /^[0-9a-f]{32,}$/i;

/**
 * Collected data for a single endpoint group during grouping
 */
interface GroupData {
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

/**
 * For Airbnb-style persisted GraphQL queries like `/api/v3/OperationName/<hash>`,
 * drop the hash segment so all requests to the same operation group together.
 * @param pathname - the URL pathname to collapse
 * @returns the pathname with trailing hex hash segment removed
 */
function collapseGraphqlHash(pathname: string): string {
  const segments = pathname.split("/");
  if (segments.length < 2) return pathname;

  const last = segments[segments.length - 1];
  if (last && HEX_HASH_RE.test(last)) {
    return segments.slice(0, -1).join("/");
  }

  return pathname;
}

/**
 * Extract the base URL (scheme + host) from the most common origin across entries.
 * @param entries - the HAR entries to extract base URL from
 * @returns the most frequently occurring base URL string
 */
function extractBaseUrl(entries: HarEntry[]): string {
  const counts = entries.reduce<Map<string, number>>((acc, entry) => {
    try {
      const url = new URL(entry.request.url);
      const base = `${url.protocol}//${url.host}`;
      const entry2: [string, number] = [base, (acc.get(base) ?? 0) + 1];
      return new Map([...acc, entry2]);
    } catch {
      return acc;
    }
  }, new Map());

  return [...counts.entries()].reduce(
    (best, [base, count]) => (count > best.count ? { base, count } : best),
    { base: "", count: 0 }
  ).base;
}

/**
 * Try to parse a JSON string, returning undefined on failure.
 * @param text - the string to parse as JSON
 * @returns the parsed value, or undefined if parsing fails
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
 * Extracts the pathname from a URL string, returning null for unparseable URLs
 * @param url - the full URL string
 * @returns the pathname or null
 */
function extractPathname(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * Collects query parameters from a request into the group's param map
 * @param queryString - the request's query string parameters
 * @param existing - the existing query params map
 * @returns the updated query params map
 */
function collectQueryParams(
  queryString: { name: string; value: string }[],
  existing: Map<string, string[]>
): Map<string, string[]> {
  return queryString.reduce<Map<string, string[]>>((acc, param) => {
    const current = acc.get(param.name) ?? [];
    const entry: [string, string[]] = [param.name, [...current, param.value]];
    return new Map([...acc, entry]);
  }, existing);
}

/**
 * Collects auth-relevant headers from a request, keeping first-seen values
 * @param headers - the request headers
 * @param existing - the existing collected headers
 * @returns the updated headers record
 */
function collectHeaders(
  headers: { name: string; value: string }[],
  existing: Record<string, string>
): Record<string, string> {
  return headers.reduce<Record<string, string>>((acc, header) => {
    const lc = header.name.toLowerCase();
    if (
      (lc === "content-type" || lc === "accept" || lc === "authorization") &&
      !(header.name in acc)
    ) {
      return { ...acc, [header.name]: header.value };
    }
    return acc;
  }, existing);
}

/**
 * Processes a single HAR entry and merges it into the groups map
 * @param groups - the current groups map
 * @param entry - the HAR entry to process
 * @returns the updated groups map
 */
function processEntry(
  groups: Map<string, GroupData>,
  entry: HarEntry
): Map<string, GroupData> {
  const rawPathname = extractPathname(entry.request.url);
  if (!rawPathname) return groups;

  const method = entry.request.method.toUpperCase();
  const pathname = collapseGraphqlHash(rawPathname);
  const normalized = normalizePath(pathname);
  const groupKey = `${method}:${normalized}`;

  const existing = groups.get(groupKey);
  const group: GroupData = existing ?? {
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

  const requestBody = entry.request.postData?.text
    ? tryParseJson(entry.request.postData.text)
    : undefined;
  const responseBody = entry.response.content.text
    ? tryParseJson(entry.response.content.text)
    : undefined;

  const updated: GroupData = {
    method: group.method,
    normalizedPath: group.normalizedPath,
    originalUrls: [...group.originalUrls, entry.request.url],
    queryParams: collectQueryParams(
      entry.request.queryString,
      group.queryParams
    ),
    requestBodies:
      requestBody !== undefined
        ? [...group.requestBodies, requestBody]
        : group.requestBodies,
    responseBodies:
      responseBody !== undefined
        ? [...group.responseBodies, responseBody]
        : group.responseBodies,
    responseStatuses: [...group.responseStatuses, entry.response.status],
    headers: collectHeaders(entry.request.headers, group.headers),
    entryCount: group.entryCount + 1,
  };

  const mapEntry: [string, GroupData] = [groupKey, updated];
  return new Map([...groups, mapEntry]);
}

/**
 * Converts a GroupData into a finalized Endpoint
 * @param group - the grouped data to convert
 * @returns the finalized Endpoint
 */
function groupToEndpoint(group: GroupData): Endpoint {
  const queryParams: QueryParamInfo[] = [...group.queryParams.entries()].map(
    ([name, values]) => ({
      name,
      observedValues: [...new Set(values)],
      required: values.length === group.entryCount,
    })
  );

  return {
    method: group.method,
    normalizedPath: group.normalizedPath,
    originalUrls: group.originalUrls,
    queryParams,
    requestBodies: group.requestBodies,
    responseBodies: group.responseBodies,
    responseStatuses: group.responseStatuses,
    headers: group.headers,
  };
}

/**
 * Group HAR entries into endpoints by {method, normalizedPath}.
 * @param entries - the HAR entries to group into endpoints
 * @returns the grouped endpoints with detected base URL
 */
export function groupEndpoints(entries: HarEntry[]): EndpointGroup {
  const baseUrl = extractBaseUrl(entries);
  const groups = entries.reduce(
    (acc, entry) => processEntry(acc, entry),
    new Map<string, GroupData>()
  );
  const endpoints = [...groups.values()].map(groupToEndpoint);

  return { baseUrl, endpoints };
}
