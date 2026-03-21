import { Command } from "commander";
import chalk from "chalk";
import { startBrowserSession } from "../recorder/browser-session.js";
import { getRecordingsDir } from "../runtime/project-manager.js";

export const recordCommand = new Command("record")
  .description("Record browser traffic by navigating to a URL")
  .requiredOption("--url <url>", "URL to navigate to and record traffic from")
  .option(
    "--output <path>",
    "Output path for the recorded HAR file",
    getRecordingsDir()
  )
  .option(
    "--include-assets",
    "Include static asset requests (images, CSS, etc.)",
    false
  )
  .action(async options => {
    const harPath = await startBrowserSession({
      url: options.url,
      output: options.output,
      includeAssets: options.includeAssets,
    });

    console.log("");
    console.log(chalk.green.bold(`HAR file saved to: ${harPath}`));
    console.log("");
    console.log(
      chalk.cyan("Next step: generate an API spec from the recording:")
    );
    console.log(chalk.white(`  api-creator generate --input ${harPath}`));
    console.log("");
  });
