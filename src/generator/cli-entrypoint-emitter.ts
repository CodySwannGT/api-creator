import type { AuthInfo } from "../types/auth.js";
import type { Endpoint } from "../types/endpoint.js";

/**
 * Generates the inline `parseAuthFromInput` function definition emitted into the CLI source.
 * @returns array of source code lines implementing the cURL-parsing auth extractor
 */
function emitParseAuthFromInput(): string[] {
  return [
    "function parseAuthFromInput(input: string): AuthConfig | null {",
    "  const trimmed = input.trim();",
    "  // Join backslash-continued lines",
    "  const joined = trimmed.replace(/\\\\\\s*\\n/g, ' ');",
    "",
    "  // Check if it looks like a cURL command",
    "  const isCurl = /^curl\\s/i.test(joined);",
    "  if (!isCurl) return null;",
    "",
    "  const auth: AuthConfig = {};",
    "",
    "  // Extract cookie from -b flag",
    "  const bMatch = joined.match(/-b\\s+'([^']+)'/) || joined.match(/-b\\s+\"([^\"]+)\"/) ;",
    "  if (bMatch) auth.cookie = bMatch[1];",
    "",
    "  // Extract all -H headers",
    "  const headerPattern = /-H\\s+'([^']*)'|-H\\s+\"([^\"]*)\"/g;",
    "  const extraHeaders: Record<string, string> = {};",
    "  let hm;",
    "  while ((hm = headerPattern.exec(joined)) !== null) {",
    "    const headerStr = hm[1] || hm[2];",
    "    const colonIdx = headerStr.indexOf(':');",
    "    if (colonIdx === -1) continue;",
    "    const hName = headerStr.slice(0, colonIdx).trim();",
    "    const hValue = headerStr.slice(colonIdx + 1).trim();",
    "    const hLower = hName.toLowerCase();",
    "",
    "    // Cookie header",
    "    if (hLower === 'cookie') { auth.cookie = hValue; continue; }",
    "    // Bearer token",
    "    if (hLower === 'authorization' && hValue.toLowerCase().startsWith('bearer ')) {",
    "      auth.token = hValue.replace(/^[Bb]earer\\s+/, ''); continue;",
    "    }",
    "    // Interesting extra headers to preserve",
    "    if (hLower.startsWith('x-') && hValue && !hLower.startsWith('x-client-') && hLower !== 'x-csrf-without-token') {",
    "      extraHeaders[hName] = hValue;",
    "    }",
    "  }",
    "",
    "  if (Object.keys(extraHeaders).length > 0) auth.extraHeaders = extraHeaders;",
    "  if (!auth.cookie && !auth.token && !auth.apiKey) return null;",
    "  return auth;",
    "}",
    "",
  ];
}

/** Emitted source line that prints a blank line to stdout in the generated CLI. */
const BLANK_LOG_LINE = "      console.log('');";

/**
 * Generates the `auth setup` subcommand block that parses a cURL command and stores credentials.
 * @returns array of source code lines implementing the auth setup command action
 */
function emitAuthSetupCommand(): string[] {
  return [
    "authCmd.command('setup')",
    "  .description('Configure authentication from a cURL command')",
    "  .option('-f, --file <path>', 'Read cURL command from a file')",
    "  .action(async (options: { file?: string }) => {",
    "    let input: string;",
    "",
    "    if (options.file) {",
    "      const { readFileSync } = await import('node:fs');",
    "      input = readFileSync(options.file, 'utf-8');",
    "    } else if (!process.stdin.isTTY) {",
    "      // Piped input: cat curl.txt | airbnb auth setup",
    "      const chunks: string[] = [];",
    "      process.stdin.setEncoding('utf8');",
    "      for await (const chunk of process.stdin) { chunks.push(chunk as string); }",
    "      input = chunks.join('');",
    "    } else {",
    BLANK_LOG_LINE,
    "      console.log('To set up auth, copy a cURL command from Chrome DevTools:');",
    "      console.log('  1. Open ' + ORIGINAL_URL + ' in your browser (make sure you are logged in)');",
    "      console.log('  2. Open DevTools (F12) -> Network tab');",
    "      console.log('  3. Right-click any API request -> Copy -> Copy as cURL');",
    "      console.log('  4. Save it to a file, then run:');",
    BLANK_LOG_LINE,
    "      console.log('    ' + CLI_NAME + ' auth setup --file curl.txt');",
    BLANK_LOG_LINE,
    "      console.log('  Or pipe it directly:');",
    BLANK_LOG_LINE,
    "      console.log('    pbpaste | ' + CLI_NAME + ' auth setup');",
    BLANK_LOG_LINE,
    "      process.exit(0);",
    "    }",
    "",
    "    if (!input.trim()) { console.error('No input provided.'); process.exit(1); }",
    "",
    "    const parsed = parseAuthFromInput(input);",
    "    if (parsed) {",
    "      saveAuth(parsed);",
    "      const parts: string[] = [];",
    "      if (parsed.cookie) parts.push('cookie');",
    "      if (parsed.token) parts.push('bearer token');",
    "      if (parsed.apiKey) parts.push('API key');",
    "      if (parsed.extraHeaders) parts.push(Object.keys(parsed.extraHeaders).length + ' extra header(s)');",
    "      console.log('Auth saved. Extracted: ' + parts.join(', '));",
    "    } else {",
    "      console.error('Could not parse auth from input. Make sure it is a valid cURL command with -b or -H Cookie header.');",
    "      process.exit(1);",
    "    }",
    "  });",
    "",
  ];
}

/**
 * Generates the `auth status` subcommand block that checks credential validity via a health-check.
 * @param baseUrl - the API base URL used for the live health-check request
 * @returns array of source code lines implementing the auth status command action
 */
function emitAuthStatusCommand(baseUrl: string): string[] {
  return [
    "authCmd.command('status')",
    "  .description('Check if authentication is configured')",
    "  .action(async () => {",
    "    if (!isAuthConfigured()) {",
    "      console.log('Not configured. Run: ' + CLI_NAME + ' auth setup');",
    "      return;",
    "    }",
    "    console.log('Auth is configured (.auth file exists).');",
    "    const auth = loadAuth();",
    "    if (!auth) {",
    "      console.log('Warning: .auth file exists but could not be parsed.');",
    "      return;",
    "    }",
    "    if (auth.cookie) console.log('  Type: cookie');",
    "    if (auth.token) console.log('  Type: bearer token');",
    "    if (auth.apiKey) console.log('  Type: API key');",
    "",
    "    // Health check",
    `    const client = new ApiClient('${baseUrl}', auth);`,
    "    try {",
    "      const result = await client.healthCheck();",
    "      if (result.valid) { console.log('  Status: valid'); }",
    "      else { console.log('  Status: ' + result.message); }",
    "    } catch {",
    "      console.log('  Status: could not verify');",
    "    }",
    "  });",
    "",
  ];
}

/**
 * Generates the CLI entrypoint source code, including auth commands
 * and endpoint command registration.
 * @param name - the CLI project name
 * @param _endpoints - the API endpoints (reserved for future use)
 * @param _authInfos - detected auth mechanisms (reserved for future use)
 * @param baseUrl - the base URL for the API
 * @param originalUrl - the original URL the CLI was generated from
 * @returns the generated CLI entrypoint source code
 */
export function emitCli(
  name: string,
  _endpoints: Endpoint[],
  _authInfos: AuthInfo[],
  baseUrl: string,
  originalUrl: string
): string {
  return [
    "import { Command } from 'commander';",
    "import { createInterface } from 'node:readline';",
    "import { loadAuth, saveAuth, isAuthConfigured, clearAuth, AUTH_TYPE, ORIGINAL_URL, CLI_NAME } from './auth.js';",
    "import type { AuthConfig } from './auth.js';",
    "import { ApiClient } from './client.js';",
    "import { registerEndpointCommands } from './commands.js';",
    "",
    `const program = new Command('${name}');`,
    `program.version('0.1.0');`,
    `program.description('Auto-generated CLI for ${originalUrl}');`,
    "",
    "const authCmd = program.command('auth').description('Manage authentication');",
    "",
    ...emitParseAuthFromInput(),
    ...emitAuthSetupCommand(),
    ...emitAuthStatusCommand(baseUrl),
    "authCmd.command('clear')",
    "  .description('Remove stored authentication credentials')",
    "  .action(() => {",
    "    clearAuth();",
    "    console.log('Auth cleared.');",
    "  });",
    "",
    "registerEndpointCommands(program);",
    "",
    "program.parse();",
    "",
  ].join("\n");
}
