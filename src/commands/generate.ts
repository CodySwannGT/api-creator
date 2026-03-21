import { Command } from "commander";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { generateClient } from "../generator/codegen.js";
import { getRecordingsDir } from "../runtime/project-manager.js";

/**
 * Represents a file with its path and modification time
 */
type FileEntry = { filePath: string; mtimeMs: number };

/**
 * Find the most recent .har file in the given directory.
 * @param dir - the directory to search for HAR files
 * @returns the absolute path to the most recently modified HAR file, or null if none found
 */
async function findMostRecentHar(dir: string): Promise<string | null> {
  const files = await readdir(dir).catch(() => [] as string[]);

  const harFiles = files.filter(f => f.endsWith(".har"));
  if (harFiles.length === 0) return null;

  const entries = await Promise.all(
    harFiles.map(async (file): Promise<FileEntry | null> => {
      const filePath = join(dir, file);
      try {
        const s = await stat(filePath);
        return { filePath, mtimeMs: s.mtimeMs };
      } catch {
        return null;
      }
    })
  );

  const valid = entries.filter((e): e is FileEntry => e !== null);
  if (valid.length === 0) return null;

  return valid.reduce(
    (best: FileEntry, e: FileEntry) => (e.mtimeMs > best.mtimeMs ? e : best),
    valid[0]
  ).filePath;
}

/**
 * Derive a project name from a HAR file path or domain.
 * E.g., "recordings/airbnb.com.har" -> "airbnb"
 * @param harPath - the path to the HAR file
 * @returns a derived lowercase project name, or "api-client" as fallback
 */
function deriveNameFromHarPath(harPath: string): string {
  const segments = harPath.split("/");
  const basename = segments[segments.length - 1] ?? "api-client";
  const noExt = basename.replace(/\.har$/i, "");
  const domainMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(noExt);
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
      const recordingsDir = getRecordingsDir();
      const inputPath: string =
        options.input ?? (await findMostRecentHar(recordingsDir));

      if (!inputPath) {
        console.error(
          chalk.red(
            "No HAR file found. Provide --input <path> or place a .har file in ./recordings/"
          )
        );
        process.exit(1);
      }

      if (!options.input) {
        console.log(chalk.gray(`  Using HAR file: ${inputPath}`));
      }

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
