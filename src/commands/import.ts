import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { detectFormat } from '../importer/format-detector.js';
import { parseInput } from '../importer/paste-parser.js';
import type { HarLog } from '../types/har.js';

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

export const importCommand = new Command('import')
  .description('Import API requests from cURL, fetch, HAR, or raw HTTP format')
  .option('--file <path>', 'Path to a file containing the requests to import')
  .action(async (options: { file?: string }) => {
    let input: string;

    if (options.file) {
      const filePath = path.resolve(options.file);
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`Error: File not found: ${filePath}`));
        process.exit(1);
      }
      input = fs.readFileSync(filePath, 'utf8');
    } else {
      console.log(chalk.cyan('Paste your API request(s) below, then press Ctrl+D when done:\n'));
      input = await readStdin();
    }

    const trimmed = input.trim();
    if (!trimmed) {
      console.error(chalk.red('Error: No input provided.'));
      process.exit(1);
    }

    const spinner = ora('Detecting format...').start();

    const format = detectFormat(trimmed);
    if (format === 'unknown') {
      spinner.fail(chalk.red('Could not detect input format. Supported formats: cURL, fetch(), HAR JSON, raw HTTP.'));
      process.exit(1);
    }

    spinner.text = `Detected format: ${chalk.bold(format)}. Parsing...`;

    const entries = parseInput(trimmed, format);
    if (entries.length === 0) {
      spinner.fail(chalk.red('No requests could be parsed from the input.'));
      process.exit(1);
    }

    spinner.text = 'Saving HAR file...';

    const harLog: HarLog = {
      log: {
        version: '1.2',
        creator: { name: 'api-creator', version: '0.1.0' },
        entries,
      },
    };

    const recordingsDir = path.resolve('recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const outputPath = path.join(recordingsDir, `${timestamp}.har`);
    fs.writeFileSync(outputPath, JSON.stringify(harLog, null, 2), 'utf8');

    spinner.succeed(chalk.green(`Parsed ${chalk.bold(String(entries.length))} request(s) from ${chalk.bold(format)} format.`));
    console.log(chalk.gray(`  Saved to: ${outputPath}`));
    console.log();
    console.log(chalk.cyan(`  Next step: run ${chalk.bold(`api-creator generate --input ${outputPath}`)}`));
  });
