import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import { attachNetworkCapture } from './network-capture.js';

export async function startBrowserSession(options: {
  url: string;
  output?: string;
  includeAssets?: boolean;
}): Promise<string> {
  const timestamp = Date.now();
  const outputDir = options.output ?? './recordings';
  const harFilename = `${timestamp}.har`;
  const harPath = path.resolve(outputDir, harFilename);

  // Ensure the output directory exists
  fs.mkdirSync(path.resolve(outputDir), { recursive: true });

  // Create a temp directory for the persistent context user data
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-creator-'));

  const spinner = ora('Launching browser...').start();

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      recordHar: {
        path: harPath,
        omitContent: false,
      },
    });
  } catch (err) {
    spinner.fail('Failed to launch browser');
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Executable doesn't exist")) {
      console.log(chalk.yellow('\nChromium browser is not installed for Playwright.'));
      console.log(chalk.white('Run this to install it:\n'));
      console.log(chalk.cyan('  npx playwright install chromium\n'));
      console.log(chalk.gray('Then try again.'));
      process.exit(1);
    }
    throw err;
  }

  spinner.succeed('Browser launched');

  const page = context.pages()[0] ?? await context.newPage();

  attachNetworkCapture(page, { includeAssets: options.includeAssets ?? false });

  console.log(chalk.blue(`Navigating to ${options.url}...`));
  await page.goto(options.url);
  console.log(chalk.green('Page loaded. Browse around to record API traffic.'));
  console.log(chalk.gray('Press "q" then Enter to stop recording and save.\n'));

  return new Promise<string>((resolve) => {
    let stopping = false;

    const cleanup = async () => {
      if (stopping) return;
      stopping = true;

      // Stop listening for input
      if (process.stdin.isRaw) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();

      console.log(chalk.yellow('\n\nStopping recording...'));
      const closeSpinner = ora('Closing browser and saving HAR...').start();
      try {
        await context.close();
        closeSpinner.succeed(`HAR file saved to ${harPath}`);
      } catch {
        closeSpinner.warn('Browser closed');
      }

      // Clean up temp user data directory
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      resolve(harPath);

      // Force exit since Playwright can leave handles open
      process.exit(0);
    };

    // Listen for "q" keypress as primary stop mechanism
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key: string) => {
      if (key.trim().toLowerCase() === 'q') {
        void cleanup();
      }
    });

    // Also handle SIGINT/SIGTERM as fallback
    process.on('SIGINT', () => {
      void cleanup();
    });
    process.on('SIGTERM', () => {
      void cleanup();
    });

    // Also stop if the browser is closed manually
    context.on('close', () => {
      if (!stopping) {
        console.log(chalk.yellow('\nBrowser closed.'));
        stopping = true;
        resolve(harPath);
        process.exit(0);
      }
    });
  });
}
