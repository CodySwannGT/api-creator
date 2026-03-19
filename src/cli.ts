import { createRequire } from "module";
import { Command } from "commander";
import { recordCommand } from "./commands/record.js";
import { importCommand } from "./commands/import.js";
import { generateCommand } from "./commands/generate.js";
import { testCommand } from "./commands/test.js";
import { listCommand } from "./commands/list.js";
import { exportCommand } from "./commands/export.js";
import { registerProjectCommands } from "./runtime/project-runner.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("api-creator")
  .description(
    "Reverse-engineer any web API into a typed CLI by recording real browser traffic"
  )
  .version(version);

program.addCommand(recordCommand);
program.addCommand(importCommand);
program.addCommand(generateCommand);
program.addCommand(testCommand);
program.addCommand(listCommand);
program.addCommand(exportCommand);

// Dynamically register subcommands for each project in ~/.api-creator/projects/
registerProjectCommands(program);

program.parse();
