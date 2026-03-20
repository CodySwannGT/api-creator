import { Command } from "commander";
import chalk from "chalk";
import {
  listProjects,
  loadManifest,
  loadAuth,
} from "../runtime/project-manager.js";

export const listCommand = new Command("list")
  .description("List all generated API projects")
  .action(() => {
    const projects = listProjects();

    if (projects.length === 0) {
      console.log(
        chalk.gray(
          "\n  No projects found. Run `api-creator generate` to create one.\n"
        )
      );
      return;
    }

    console.log(chalk.blue.bold(`\n  ${projects.length} project(s):\n`));

    for (const name of projects) {
      const manifest = loadManifest(name);
      const auth = loadAuth(name);

      if (!manifest) {
        console.log(
          `  ${chalk.white(name)} ${chalk.gray("(invalid manifest)")}`
        );
        continue;
      }

      const authStatus = auth
        ? chalk.green("authenticated")
        : chalk.yellow("no auth");
      const endpointCount = manifest.endpoints.length;

      console.log(
        `  ${chalk.white.bold(name)}  ${chalk.gray(manifest.baseUrl)}  ${chalk.gray(`${endpointCount} endpoint(s)`)}  ${authStatus}`
      );
    }

    console.log("");
  });
