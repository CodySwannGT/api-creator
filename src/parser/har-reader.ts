import { readFile } from "node:fs/promises";
import type { HarLog, HarEntry } from "../types/har.js";

const STATIC_RESOURCE_TYPES = new Set([
  "image",
  "font",
  "stylesheet",
  "script",
  "media",
  "manifest",
  "texttrack",
  "websocket",
  "ping",
  "preflight",
  "other",
]);

const STATIC_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".avif",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".ts",
  ".tsx",
  ".jsx",
  ".mp4",
  ".mp3",
  ".webm",
  ".ogg",
  ".wav",
]);

/** Path substrings that indicate tracking/analytics requests. */
const TRACKING_PATH_KEYWORDS = [
  "tracking",
  "logging",
  "beacon",
  "pixel",
  "analytics",
  "telemetry",
  "metrics",
];

/** Domain substrings that indicate ad/tracking services. */
const AD_DOMAINS = [
  "googleads",
  "doubleclick",
  "googlesyndication",
  "facebook.com/tr",
  "bing.com",
  "pagead",
];

/** Well-known static files that should never be treated as API calls. */
const STATIC_FILES = [
  "manifest.json",
  "favicon.ico",
  "robots.txt",
  "sw.js",
  "service-worker",
];

/**
 * Safely parses a JSON string, throwing a descriptive error on failure
 * @param raw - the raw JSON string to parse
 * @param filePath - the file path for error messages
 * @returns the parsed JSON value
 */
function safeParseJson(raw: string, filePath: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in HAR file: ${filePath}`);
  }
}

/**
 * Read and parse a HAR file from disk.
 * Validates the top-level structure before returning entries.
 * @param filePath - absolute or relative path to the .har file
 * @returns the parsed HAR entries array
 */
export async function readHarFile(filePath: string): Promise<HarEntry[]> {
  const raw = await readFile(filePath, "utf-8");

  const parsed = safeParseJson(raw, filePath);

  const har = parsed as HarLog;

  if (!har || typeof har !== "object") {
    throw new Error(`HAR file does not contain a valid object: ${filePath}`);
  }

  if (!har.log || !Array.isArray(har.log.entries)) {
    throw new Error(
      `HAR file is missing required "log.entries" array: ${filePath}`
    );
  }

  return har.log.entries;
}

/**
 * Checks whether a URL should be excluded based on path patterns and domain lists
 * @param entry - the HAR entry to check
 * @returns true if the entry should be excluded
 */
function isExcludedByUrl(entry: HarEntry): boolean {
  try {
    const urlObj = new URL(entry.request.url);
    const pathname = urlObj.pathname.toLowerCase();
    const fullUrl = entry.request.url.toLowerCase();

    const lastDot = pathname.lastIndexOf(".");
    if (lastDot !== -1) {
      const ext = pathname.slice(lastDot).split("?")[0];
      if (STATIC_EXTENSIONS.has(ext)) return true;
    }

    if (TRACKING_PATH_KEYWORDS.some(kw => pathname.includes(kw))) return true;
    if (AD_DOMAINS.some(domain => fullUrl.includes(domain))) return true;
    if (STATIC_FILES.some(file => pathname.includes(file))) return true;
    if (fullUrl.includes("$rpc")) return true;
  } catch {
    // If URL is unparseable, don't exclude
  }
  return false;
}

/**
 * Checks whether a HAR entry looks like an API request worth keeping
 * @param entry - the HAR entry to check
 * @returns true if the entry appears to be an API call
 */
function isApiLikeEntry(entry: HarEntry): boolean {
  const responseMime = entry.response.content.mimeType?.toLowerCase() ?? "";
  if (responseMime.includes("application/json")) return true;

  const requestMime = entry.request.postData?.mimeType?.toLowerCase() ?? "";
  if (
    requestMime.includes("application/x-www-form-urlencoded") ||
    requestMime.includes("multipart/form-data") ||
    requestMime.includes("application/json")
  ) {
    return true;
  }

  const rt = entry._resourceType?.toLowerCase();
  if (rt === "xhr" || rt === "fetch") return true;

  return false;
}

/**
 * Filter out static asset requests, keeping only JSON API responses
 * and form submissions.
 * @param entries - the raw HAR entries to filter
 * @returns only the entries that look like API calls
 */
export function filterApiRequests(entries: HarEntry[]): HarEntry[] {
  return entries.filter(entry => {
    if (
      entry._resourceType &&
      STATIC_RESOURCE_TYPES.has(entry._resourceType.toLowerCase())
    ) {
      return false;
    }

    if (isExcludedByUrl(entry)) return false;

    return isApiLikeEntry(entry);
  });
}
