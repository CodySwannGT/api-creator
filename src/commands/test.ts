import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import chalk from "chalk";

import {
  parseEndpoints,
  extractBaseUrl,
  buildAuthHeaders,
  findHealthCheckEndpoint,
  selectTestEndpoints,
  testEndpoint,
} from "./test-helpers.js";

/** Options type for the test command action. */
type TestOptions = {
  dir: string;
  cookie?: string;
  token?: string;
  apiKey?: string;
  baseUrl?: string;
  endpoint?: string;
  list?: boolean;
};

/**
 * Loads and parses the client source file, exiting with an error if not found.
 * @param clientPath - the absolute path to the client TypeScript file
 * @returns the source code as a string
 */
async function loadClientSource(clientPath: string): Promise<string> {
  try {
    return await readFile(clientPath, "utf-8");
  } catch {
    console.error(chalk.red(`\n  No generated client found at ${clientPath}`));
    console.error(chalk.gray("  Run `api-creator generate` first.\n"));
    process.exit(1);
  }
}

/**
 * Prints a formatted list of all available endpoints to stdout.
 * @param endpoints - the parsed endpoints to display
 * @param clientPath - the path to the client file (used in the heading)
 */
function listEndpoints(
  endpoints: ReturnType<typeof parseEndpoints>,
  clientPath: string
): void {
  console.log(
    chalk.blue.bold(`\n  ${endpoints.length} endpoints in ${clientPath}:\n`)
  );
  for (const ep of endpoints) {
    const params =
      ep.params.length > 0 ? chalk.gray(`(${ep.params.join(", ")})`) : "";
    console.log(
      `  ${chalk.white(ep.method.padEnd(7))} ${chalk.cyan(ep.name)}${params}`
    );
  }
  console.log("");
}

/**
 * Runs health check + selected endpoints and returns pass/fail counts.
 * @param baseUrl - the base URL to send requests to
 * @param endpoints - all parsed endpoints (used to find a health check)
 * @param toTest - the subset of endpoints to test
 * @param authHeaders - auth headers to attach to each request
 * @returns the number of passed and failed tests
 */
async function runTests(
  baseUrl: string,
  endpoints: ReturnType<typeof parseEndpoints>,
  toTest: ReturnType<typeof parseEndpoints>,
  authHeaders: Record<string, string>
): Promise<{ passed: number; failed: number }> {
  const healthEndpoint = findHealthCheckEndpoint(endpoints);
  if (healthEndpoint) {
    await testEndpoint(baseUrl, healthEndpoint, authHeaders, "health check");
  }

  console.log(chalk.blue(`  Testing ${toTest.length} endpoint(s)...\n`));

  return toTest.reduce(
    async (accPromise, ep) => {
      const acc = await accPromise;
      const ok = await testEndpoint(baseUrl, ep, authHeaders);
      return ok
        ? { passed: acc.passed + 1, failed: acc.failed }
        : { passed: acc.passed, failed: acc.failed + 1 };
    },
    Promise.resolve({ passed: 0, failed: 0 })
  );
}

/**
 * Validates options and resolves the base URL and auth for a test run.
 * @param clientSource - the generated client source code
 * @param options - the test command options
 * @returns the resolved base URL and auth config
 */
function resolveTestConfig(
  clientSource: string,
  options: TestOptions
): { baseUrl: string; authConfig: ReturnType<typeof buildAuthHeaders> } {
  const baseUrl = options.baseUrl ?? extractBaseUrl(clientSource);
  if (!baseUrl) {
    console.error(
      chalk.red(
        "\n  Could not determine base URL. Use --base-url to specify one.\n"
      )
    );
    process.exit(1);
  }

  const authConfig = buildAuthHeaders(clientSource, options);
  if (!authConfig.hasAuth) {
    console.log(
      chalk.yellow("\n  No auth provided. Requests may fail with 401/403.")
    );
    console.log(
      chalk.gray("  Use --cookie, --token, or --api-key to authenticate.\n")
    );
  }

  return { baseUrl, authConfig };
}

/**
 * Selects the endpoints to test based on the --endpoint option or defaults.
 * @param endpoints - all parsed endpoints
 * @param endpointName - the specific endpoint name to test, if provided
 * @returns the filtered list of endpoints to test
 */
function resolveEndpointsToTest(
  endpoints: ReturnType<typeof parseEndpoints>,
  endpointName: string | undefined
): ReturnType<typeof parseEndpoints> {
  if (!endpointName) return selectTestEndpoints(endpoints);

  const toTest = endpoints.filter(e => e.name === endpointName);
  if (toTest.length === 0) {
    console.error(chalk.red(`  Endpoint "${endpointName}" not found.`));
    console.log(chalk.gray("  Run with --list to see available endpoints.\n"));
    process.exit(1);
  }
  return toTest;
}

/**
 * Main action logic for the test command, separated for cognitive complexity.
 * @param options - the test command options
 */
async function runTestAction(options: TestOptions): Promise<void> {
  const dir = resolve(options.dir);
  const clientPath = join(dir, "client.ts");

  const clientSource = await loadClientSource(clientPath);
  const endpoints = parseEndpoints(clientSource);

  if (endpoints.length === 0) {
    console.error(
      chalk.red("\n  No endpoints found in the generated client.\n")
    );
    process.exit(1);
  }

  if (options.list) {
    listEndpoints(endpoints, clientPath);
    return;
  }

  const { baseUrl, authConfig } = resolveTestConfig(clientSource, options);
  const toTest = resolveEndpointsToTest(endpoints, options.endpoint);
  const { passed, failed } = await runTests(
    baseUrl,
    endpoints,
    toTest,
    authConfig.headers
  );

  console.log(chalk.blue.bold("\n  Testing API client\n"));
  console.log(chalk.gray(`  Base URL: ${baseUrl}`));
  console.log(chalk.gray(`  Auth: ${authConfig.description}\n`));
  console.log("");
  if (failed === 0) {
    console.log(
      chalk.green.bold(`  All ${passed} endpoint(s) responded successfully.`)
    );
  } else {
    console.log(chalk.yellow(`  ${passed} passed, ${failed} failed.`));
  }
  console.log("");
}

export const testCommand = new Command("test")
  .description("Test the generated API client by calling its endpoints")
  .option(
    "--dir <path>",
    "Directory containing the generated client",
    "./generated"
  )
  .option("--cookie <cookie>", "Cookie string for authentication")
  .option("--token <token>", "Bearer token for authentication")
  .option("--api-key <key>", "API key for authentication")
  .option("--base-url <url>", "Base URL override")
  .option("--endpoint <name>", "Test a specific endpoint method by name")
  .option("--list", "List all available endpoints without calling them")
  .action(async (options: TestOptions) => {
    try {
      await runTestAction(options);
    } catch (error) {
      console.error(
        chalk.red(
          `  Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });
