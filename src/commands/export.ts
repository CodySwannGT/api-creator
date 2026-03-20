import { Command } from "commander";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { getProjectDir, loadManifest } from "../runtime/project-manager.js";

export const exportCommand = new Command("export")
  .description("Export TypeScript client and types for programmatic use")
  .argument("<name>", "Project name")
  .option("-o, --output <dir>", "Output directory", ".")
  .action((name: string, options: { output: string }) => {
    const manifest = loadManifest(name);
    if (!manifest) {
      console.error(chalk.red(`\n  Project "${name}" not found.\n`));
      console.error(
        chalk.gray("  Run `api-creator list` to see available projects.\n")
      );
      process.exit(1);
    }

    const projectDir = getProjectDir(name);
    const outputDir = resolve(options.output);
    mkdirSync(outputDir, { recursive: true });

    const files = ["client.ts", "types.ts"];

    const copied = files.reduce((count, file) => {
      const src = join(projectDir, file);
      if (existsSync(src)) {
        copyFileSync(src, join(outputDir, file));
        console.log(chalk.gray(`  Copied ${file} -> ${join(outputDir, file)}`));
        return count + 1;
      }
      return count;
    }, 0);

    if (copied === 0) {
      console.error(chalk.yellow("\n  No TypeScript files found to export.\n"));
    } else {
      console.log(
        chalk.green(`\n  Exported ${copied} file(s) to ${outputDir}\n`)
      );
    }
  });
