import type { Page } from "playwright";
import chalk from "chalk";
import ora from "ora";

const ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".map",
]);

const ASSET_RESOURCE_TYPES = new Set([
  "image",
  "font",
  "stylesheet",
  "script",
  "media",
]);

/**
 * Determines if a request is for a static asset based on URL extension or resource type.
 * @param url - the full request URL string
 * @param resourceType - the Playwright resource type string
 * @returns true if the request is for a static asset
 */
function isAssetRequest(url: string, resourceType: string): boolean {
  const pathname = new URL(url).pathname;
  const ext = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();

  if (ASSET_EXTENSIONS.has(ext)) return true;
  if (ASSET_RESOURCE_TYPES.has(resourceType)) return true;

  return false;
}

/**
 * Truncates a URL for display purposes, showing only pathname and search.
 * @param url - the full URL string to truncate
 * @param maxLength - the maximum display length before truncating with ellipsis
 * @returns the truncated display string
 */
function truncateUrl(url: string, maxLength = 80): string {
  try {
    const parsed = new URL(url);
    const display = parsed.pathname + parsed.search;
    if (display.length <= maxLength) return display;
    return `${display.slice(0, maxLength - 3)}...`;
  } catch {
    return url.length > maxLength ? `${url.slice(0, maxLength - 3)}...` : url;
  }
}

/**
 * Returns a chalk-colored string representation of an HTTP status code.
 * @param status - the HTTP status code to colorize
 * @returns the status code string wrapped in appropriate chalk color
 */
function colorStatus(status: number): string {
  const statusStr = String(status);
  if (status >= 200 && status < 300) return chalk.green(statusStr);
  if (status >= 300 && status < 400) return chalk.yellow(statusStr);
  return chalk.red(statusStr);
}

/**
 * Attaches request and response listeners to a Playwright page to log network activity.
 * Shows a live spinner with a running count and logs each response inline.
 * @param page - the Playwright page to monitor
 * @param options - configuration options
 * @param options.includeAssets - whether to include static asset requests in the output
 */
export function attachNetworkCapture(
  page: Page,
  options: { includeAssets?: boolean }
): void {
  const spinner = ora({
    text: "Waiting for requests...",
    prefixText: "",
  }).start();
  const counter = { value: 0 };

  const updateSpinner = () => {
    spinner.start(
      `Captured ${counter.value} request${counter.value === 1 ? "" : "s"}`
    );
  };

  page.on("request", request => {
    const url = request.url();
    const resourceType = request.resourceType();

    if (!options.includeAssets && isAssetRequest(url, resourceType)) return;

    counter.value += 1;
    updateSpinner();
  });

  page.on("response", response => {
    const request = response.request();
    const url = request.url();
    const resourceType = request.resourceType();

    if (!options.includeAssets && isAssetRequest(url, resourceType)) return;

    const status = response.status();
    const method = request.method();
    const truncated = truncateUrl(url);

    spinner.stop();
    console.log(
      `  ${chalk.bold(method.padEnd(7))} ${truncated} ${colorStatus(status)}`
    );
    updateSpinner();
  });
}
