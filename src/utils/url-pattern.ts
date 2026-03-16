const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;
/** Matches long hex hash strings (32+ hex chars, no dashes — distinguishes from UUIDs). */
const HEX_HASH_RE = /^[0-9a-f]{32,}$/i;

/**
 * Normalize a URL path by replacing dynamic segments (numeric IDs, UUIDs) with `:id`.
 */
export function normalizePath(path: string): string {
  // Strip trailing slash (keep leading slash)
  const cleaned = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

  return cleaned
    .split('/')
    .map((segment) => {
      if (segment === '') return segment;
      if (NUMERIC_RE.test(segment)) return ':id';
      if (UUID_RE.test(segment)) return ':id';
      if (HEX_HASH_RE.test(segment)) return ':hash';
      return segment;
    })
    .join('/');
}
