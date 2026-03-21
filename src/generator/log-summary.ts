/**
 * Console output for the generation summary shown after a successful generate run.
 */

import { join } from "node:path";
import chalk from "chalk";
import type { Endpoint } from "../types/endpoint.js";
import type { AuthInfo } from "../types/auth.js";

/**
 * Logs the generation summary including file paths, stats, and next steps.
 * @param projectDir - the directory where files were generated
 * @param endpoints - the generated endpoints
 * @param types - the inferred response types
 * @param requestTypes - the inferred request types
 * @param auth - the detected auth mechanisms
 * @param projectName - the name of the generated project
 */
export function logSummary(
  projectDir: string,
  endpoints: Endpoint[],
  types: { name: string }[],
  requestTypes: { name: string }[],
  auth: AuthInfo[],
  projectName: string
): void {
  const authLabel = auth.length > 0 ? auth[0].type : "none";
  const typeCount = types.length + requestTypes.length;
  [
    "",
    chalk.green.bold("  Project generated successfully!"),
    "",
    chalk.white(`    ${join(projectDir, "manifest.json")}`),
    chalk.white(`    ${join(projectDir, "client.ts")}`),
    chalk.white(`    ${join(projectDir, "types.ts")}`),
    "",
    chalk.gray(
      `  ${endpoints.length} endpoints | ${typeCount} types | auth: ${authLabel}`
    ),
    "",
    chalk.cyan("  Next step — set up auth:"),
    chalk.cyan(`    api-creator ${projectName} auth setup`),
    "",
    chalk.gray("  Or from a cURL command:"),
    chalk.gray(`    api-creator ${projectName} auth setup --file curl.txt`),
    chalk.gray(`    pbpaste | api-creator ${projectName} auth setup`),
    "",
    chalk.gray(`  TypeScript client saved to ${projectDir}`),
    "",
  ].forEach(line => console.log(line));
}
