import { chromium } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import chalk from "chalk";
import ora from "ora";
import { attachNetworkCapture } from "./network-capture.js";
import { getRecordingsDir } from "../runtime/project-manager.js";

/**
 * Prepares the output directory and returns the HAR file path
 * @param outputDir - the directory for HAR output
 * @returns the resolved harPath
 */
function prepareHarPath(outputDir: string): string {
  const resolvedDir = path.resolve(outputDir);
  const timestamp = Date.now();
  const harPath = path.resolve(outputDir, `${timestamp}.har`);

  fs.mkdirSync(resolvedDir, { recursive: true });

  return harPath;
}

/**
 * Handles cleanup when the recording session ends
 * @param stopping - mutable flag to prevent double-cleanup
 * @param stopping.value whether cleanup has already started
 * @param context - the Playwright browser context to close
 * @param harPath - the HAR file path for the success message
 * @param userDataDir - the temp directory to clean up
 * @param resolve - the Promise resolve callback
 */
async function cleanupSession(
  stopping: { value: boolean },
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  harPath: string,
  userDataDir: string,
  resolve: (value: string) => void
): Promise<void> {
  if (stopping.value) return;
  stopping.value = true;

  const closeSpinner = ora("Closing browser and saving HAR...");

  if (process.stdin.isRaw) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  console.log(chalk.yellow("\n\nStopping recording..."));
  closeSpinner.start();

  try {
    await context.close();
    closeSpinner.succeed(`HAR file saved to ${harPath}`);
  } catch {
    closeSpinner.warn("Browser closed");
  }

  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  resolve(harPath);
  process.exit(0);
}

/**
 * Launches a Playwright browser context with HAR recording, navigates to a URL,
 * and waits for the user to press "q" to stop. Returns the path to the saved HAR file.
 * @param options - configuration for the browser session
 * @param options.url - the URL to navigate to after launch
 * @param options.output - optional directory to save the HAR file (default: ./recordings)
 * @param options.includeAssets - whether to log static asset requests in the network capture
 * @returns the absolute path to the saved HAR file
 */
export async function startBrowserSession(options: {
  url: string;
  output?: string;
  includeAssets?: boolean;
}): Promise<string> {
  const outputDir = options.output ?? getRecordingsDir();
  const harPath = prepareHarPath(outputDir);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-creator-"));
  const spinner = ora("Launching browser...").start();
  const context = await launchContextWithHar(userDataDir, harPath, spinner);
  const page = context.pages()[0] ?? (await context.newPage());

  spinner.succeed("Browser launched");
  attachNetworkCapture(page, { includeAssets: options.includeAssets ?? false });
  console.log(chalk.blue(`Navigating to ${options.url}...`));
  await page.goto(options.url);
  console.log(chalk.green("Page loaded. Browse around to record API traffic."));
  console.log(chalk.gray('Press "q" then Enter to stop recording and save.\n'));

  return new Promise<string>(resolve => {
    const stoppingState = { value: false };

    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (key: string) => {
      if (key.trim().toLowerCase() === "q") {
        void cleanupSession(
          stoppingState,
          context,
          harPath,
          userDataDir,
          resolve
        );
      }
    });

    process.on("SIGINT", () => {
      void cleanupSession(
        stoppingState,
        context,
        harPath,
        userDataDir,
        resolve
      );
    });
    process.on("SIGTERM", () => {
      void cleanupSession(
        stoppingState,
        context,
        harPath,
        userDataDir,
        resolve
      );
    });

    context.on("close", () => {
      if (!stoppingState.value) {
        stoppingState.value = true;
        console.log(chalk.yellow("\nBrowser closed."));
        resolve(harPath);
        process.exit(0);
      }
    });
  });
}

/**
 * Launches a persistent Playwright browser context with HAR recording enabled.
 * Handles the "no chromium" error with a user-friendly message.
 * @param userDataDir - the temp directory for browser profile data
 * @param harPath - the file path where the HAR file will be saved
 * @param spinner - the ora spinner instance to fail on launch error
 * @returns the launched BrowserContext
 */
async function launchContextWithHar(
  userDataDir: string,
  harPath: string,
  spinner: ReturnType<typeof ora>
): Promise<Awaited<ReturnType<typeof chromium.launchPersistentContext>>> {
  try {
    return await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      recordHar: {
        path: harPath,
        omitContent: false,
      },
    });
  } catch (err) {
    spinner.fail("Failed to launch browser");
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Executable doesn't exist")) {
      console.log(
        chalk.yellow("\nChromium browser is not installed for Playwright.")
      );
      console.log(chalk.white("Run this to install it:\n"));
      console.log(chalk.cyan("  npx playwright install chromium\n"));
      console.log(chalk.gray("Then try again."));
      process.exit(1);
    }
    throw err;
  }
}
