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
 *
 * @param url
 * @param resourceType
 */
function isAssetRequest(url: string, resourceType: string): boolean {
  const pathname = new URL(url).pathname;
  const ext = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();

  if (ASSET_EXTENSIONS.has(ext)) return true;
  if (ASSET_RESOURCE_TYPES.has(resourceType)) return true;

  return false;
}

/**
 *
 * @param url
 * @param maxLength
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
 *
 * @param status
 */
function colorStatus(status: number): string {
  const statusStr = String(status);
  if (status >= 200 && status < 300) return chalk.green(statusStr);
  if (status >= 300 && status < 400) return chalk.yellow(statusStr);
  return chalk.red(statusStr);
}

/**
 *
 * @param page
 * @param options
 * @param options.includeAssets
 */
export function attachNetworkCapture(
  page: Page,
  options: { includeAssets?: boolean }
): void {
  let requestCount = 0;
  const spinner = ora({
    text: "Waiting for requests...",
    prefixText: "",
  }).start();

  const updateSpinner = () => {
    spinner.text = `Captured ${requestCount} request${requestCount === 1 ? "" : "s"}`;
  };

  page.on("request", request => {
    const url = request.url();
    const resourceType = request.resourceType();

    if (!options.includeAssets && isAssetRequest(url, resourceType)) return;

    requestCount++;
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
    spinner.start();
    updateSpinner();
  });
}
