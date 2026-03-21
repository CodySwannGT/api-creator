import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { detectFormat } from "../importer/format-detector.js";
import { parseInput } from "../importer/paste-parser.js";
import type { HarLog } from "../types/har.js";
import { getRecordingsDir } from "../runtime/project-manager.js";

/**
 * Reads all stdin data until EOF and returns it as a UTF-8 string.
 * @returns a promise resolving to the full stdin content
 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      chunks.push(chunk); // eslint-disable-line functional/immutable-data -- collecting stream chunks requires mutation
    });
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

/**
 * Reads the input string from either a file path or stdin.
 * @param file - optional file path to read from; if absent, reads from stdin
 * @returns the input content as a UTF-8 string
 */
async function readInput(file: string | undefined): Promise<string> {
  if (file) {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`Error: File not found: ${filePath}`));
      process.exit(1);
    }
    return fs.readFileSync(filePath, "utf8");
  }

  console.log(
    chalk.cyan(
      "Paste your API request(s) below, then press Ctrl+D when done:\n"
    )
  );
  return readStdin();
}

/**
 * Saves a HAR log object to a timestamped file in the recordings directory.
 * @param harLog - the HAR log to serialize and save
 * @returns the absolute path to the saved file
 */
function saveHarLog(harLog: HarLog): string {
  const recordingsDir = getRecordingsDir();
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }
  const timestamp = Date.now();
  const outputPath = path.join(recordingsDir, `${timestamp}.har`);
  fs.writeFileSync(outputPath, JSON.stringify(harLog, null, 2), "utf8");
  return outputPath;
}

export const importCommand = new Command("import")
  .description("Import API requests from cURL, fetch, HAR, or raw HTTP format")
  .option("--file <path>", "Path to a file containing the requests to import")
  .action(async (options: { file?: string }) => {
    const input = await readInput(options.file);

    const trimmed = input.trim();
    if (!trimmed) {
      console.error(chalk.red("Error: No input provided."));
      process.exit(1);
    }

    const spinner = ora("Detecting format...").start();

    const format = detectFormat(trimmed);
    if (format === "unknown") {
      spinner.fail(
        chalk.red(
          "Could not detect input format. Supported formats: cURL, fetch(), HAR JSON, raw HTTP."
        )
      );
      process.exit(1);
    }

    spinner.succeed(`Detected format: ${chalk.bold(format)}`);

    const parseSpinner = ora("Parsing...").start();
    const entries = parseInput(trimmed, format);
    if (entries.length === 0) {
      parseSpinner.fail(
        chalk.red("No requests could be parsed from the input.")
      );
      process.exit(1);
    }

    parseSpinner.succeed("Parsed successfully");

    const saveSpinner = ora("Saving HAR file...").start();
    const harLog: HarLog = {
      log: {
        version: "1.2",
        creator: { name: "api-creator", version: "0.1.0" },
        entries,
      },
    };

    const outputPath = saveHarLog(harLog);

    saveSpinner.succeed(
      chalk.green(
        `Parsed ${chalk.bold(String(entries.length))} request(s) from ${chalk.bold(format)} format.`
      )
    );
    console.log(chalk.gray(`  Saved to: ${outputPath}`));
    console.log();
    console.log(
      chalk.cyan(
        `  Next step: run ${chalk.bold(`api-creator generate --input ${outputPath}`)}`
      )
    );
  });
