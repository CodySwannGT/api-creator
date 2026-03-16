import { readFile } from 'node:fs/promises';
import type { HarLog, HarEntry } from '../types/har.js';

const STATIC_RESOURCE_TYPES = new Set([
  'image',
  'font',
  'stylesheet',
  'script',
  'media',
  'manifest',
  'texttrack',
  'websocket',
  'ping',
  'preflight',
  'other',
]);

const STATIC_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.avif',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.css',
  '.js',
  '.mjs',
  '.map',
  '.ts',
  '.tsx',
  '.jsx',
  '.mp4',
  '.mp3',
  '.webm',
  '.ogg',
  '.wav',
]);

/** Path substrings that indicate tracking/analytics requests. */
const TRACKING_PATH_KEYWORDS = [
  'tracking',
  'logging',
  'beacon',
  'pixel',
  'analytics',
  'telemetry',
  'metrics',
];

/** Domain substrings that indicate ad/tracking services. */
const AD_DOMAINS = [
  'googleads',
  'doubleclick',
  'googlesyndication',
  'facebook.com/tr',
  'bing.com',
  'pagead',
];

/** Well-known static files that should never be treated as API calls. */
const STATIC_FILES = [
  'manifest.json',
  'favicon.ico',
  'robots.txt',
  'sw.js',
  'service-worker',
];

/**
 * Read and parse a HAR file from disk.
 * Validates the top-level structure before returning entries.
 */
export async function readHarFile(filePath: string): Promise<HarEntry[]> {
  const raw = await readFile(filePath, 'utf-8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in HAR file: ${filePath}`);
  }

  const har = parsed as HarLog;

  if (!har || typeof har !== 'object') {
    throw new Error(`HAR file does not contain a valid object: ${filePath}`);
  }

  if (!har.log || !Array.isArray(har.log.entries)) {
    throw new Error(
      `HAR file is missing required "log.entries" array: ${filePath}`,
    );
  }

  return har.log.entries;
}

/**
 * Filter out static asset requests, keeping only JSON API responses
 * and form submissions.
 */
export function filterApiRequests(entries: HarEntry[]): HarEntry[] {
  return entries.filter((entry) => {
    // Exclude by _resourceType if available
    if (
      entry._resourceType &&
      STATIC_RESOURCE_TYPES.has(entry._resourceType.toLowerCase())
    ) {
      return false;
    }

    // Exclude by URL extension, tracking paths, ad domains, static files, and RPC endpoints
    try {
      const urlObj = new URL(entry.request.url);
      const pathname = urlObj.pathname.toLowerCase();
      const fullUrl = entry.request.url.toLowerCase();

      // Exclude static file extensions
      const lastDot = pathname.lastIndexOf('.');
      if (lastDot !== -1) {
        const ext = pathname.slice(lastDot).split('?')[0];
        if (STATIC_EXTENSIONS.has(ext)) {
          return false;
        }
      }

      // Exclude tracking/analytics paths
      if (TRACKING_PATH_KEYWORDS.some((kw) => pathname.includes(kw))) {
        return false;
      }

      // Exclude ad-related domains
      if (AD_DOMAINS.some((domain) => fullUrl.includes(domain))) {
        return false;
      }

      // Exclude well-known static files
      if (STATIC_FILES.some((file) => pathname.includes(file))) {
        return false;
      }

      // Exclude Google Maps internal RPC endpoints
      if (fullUrl.includes('$rpc')) {
        return false;
      }
    } catch {
      // If URL is unparseable, keep the entry
    }

    // Keep JSON API responses
    const responseMime = entry.response.content.mimeType?.toLowerCase() ?? '';
    if (responseMime.includes('application/json')) {
      return true;
    }

    // Keep form submissions (POST with form content types)
    const requestMime = entry.request.postData?.mimeType?.toLowerCase() ?? '';
    if (
      requestMime.includes('application/x-www-form-urlencoded') ||
      requestMime.includes('multipart/form-data') ||
      requestMime.includes('application/json')
    ) {
      return true;
    }

    // Keep XHR/fetch resource types
    if (entry._resourceType) {
      const rt = entry._resourceType.toLowerCase();
      if (rt === 'xhr' || rt === 'fetch') {
        return true;
      }
    }

    return false;
  });
}
