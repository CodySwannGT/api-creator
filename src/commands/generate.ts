import { Command } from "commander";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { generateClient } from "../generator/codegen.js";

/**
 * Find the most recent .har file in the given directory.
 * @param dir
 */
async function findMostRecentHar(dir: string): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  const harFiles = files.filter(f => f.endsWith(".har"));
  if (harFiles.length === 0) return null;

  let newest: string | null = null;
  let newestMtime = 0;

  for (const file of harFiles) {
    const filePath = join(dir, file);
    try {
      const s = await stat(filePath);
      if (s.mtimeMs > newestMtime) {
        newestMtime = s.mtimeMs;
        newest = filePath;
      }
    } catch {
      // skip
    }
  }

  return newest;
}

/**
 * Derive a project name from a HAR file path or domain.
 * E.g., "recordings/airbnb.com.har" -> "airbnb"
 * @param harPath
 */
function deriveNameFromHarPath(harPath: string): string {
  const basename = harPath.split("/").pop() ?? "api-client";
  // Strip .har extension
  const noExt = basename.replace(/\.har$/i, "");
  // Try to extract a domain-like name: "airbnb.com" -> "airbnb"
  const domainMatch = noExt.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  if (domainMatch) {
    return domainMatch[1].toLowerCase();
  }
  return "api-client";
}

export const generateCommand = new Command("generate")
  .description("Generate an API project from recorded API traffic")
  .option("--input <path>", "Path to the HAR file or recordings directory")
  .option("--name <name>", "Name for the generated project")
  .option("--base-url <url>", "Base URL override for the API client")
  .action(async options => {
    try {
      let inputPath = options.input;

      // Default: look for most recent .har file in ./recordings/
      if (!inputPath) {
        const recordingsDir = resolve("./recordings");
        inputPath = await findMostRecentHar(recordingsDir);

        if (!inputPath) {
          console.error(
            chalk.red(
              "No HAR file found. Provide --input <path> or place a .har file in ./recordings/"
            )
          );
          process.exit(1);
        }

        console.log(chalk.gray(`  Using HAR file: ${inputPath}`));
      }

      // Derive name from HAR file if not provided
      const name = options.name ?? deriveNameFromHarPath(inputPath);

      console.log(chalk.blue.bold("\n  Generating API project...\n"));

      await generateClient({
        inputPath: resolve(inputPath),
        name,
        baseUrl: options.baseUrl,
      });
    } catch (error) {
      console.error(
        chalk.red(
          `  Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });
