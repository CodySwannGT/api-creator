import type { Endpoint } from '../types/endpoint.js';
import type { AuthInfo } from '../types/auth.js';
import type { TypeDefinition } from '../parser/type-inferrer.js';
import { pathToMethodName } from '../utils/naming.js';
import { methodNameToCliCommand } from '../utils/naming.js';

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------

export function emitProjectPackageJson(name: string): string {
  const pkg = {
    name,
    version: '0.1.0',
    type: 'module',
    bin: {
      [name]: './bin/cli.js',
    },
    scripts: {
      build: 'tsc',
    },
    dependencies: {
      commander: '^14.0.0',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// tsconfig.json
// ---------------------------------------------------------------------------

export function emitProjectTsconfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      declaration: true,
      sourceMap: true,
    },
    include: ['src'],
  };
  return JSON.stringify(config, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// .gitignore
// ---------------------------------------------------------------------------

export function emitProjectGitignore(): string {
  return ['node_modules', 'dist', '.auth', ''].join('\n');
}

// ---------------------------------------------------------------------------
// bin/cli.js
// ---------------------------------------------------------------------------

export function emitProjectBinEntry(_name: string): string {
  const lines = [
    '#!/usr/bin/env node',
    "import '../dist/cli.js';",
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// src/auth.ts
// ---------------------------------------------------------------------------

export function emitAuthModule(
  authInfos: AuthInfo[],
  originalUrl: string,
  name: string,
): string {
  const primaryAuth = authInfos.length > 0 ? authInfos[0] : null;
  const lines: string[] = [];

  lines.push("import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';");
  lines.push("import { join } from 'node:path';");
  lines.push('');

  lines.push('export interface AuthConfig {');
  lines.push('  cookie?: string;');
  lines.push('  token?: string;');
  lines.push('  apiKey?: string;');
  lines.push('  extraHeaders?: Record<string, string>;');
  lines.push('}');
  lines.push('');

  lines.push("export const AUTH_FILE = join(process.cwd(), '.auth');");
  lines.push('');

  // Describe what auth type was detected
  const authType = primaryAuth?.type ?? 'none';
  lines.push(`/** Detected auth type: ${authType} */`);
  lines.push(`export const AUTH_TYPE = '${authType}' as const;`);
  lines.push(`export const ORIGINAL_URL = '${originalUrl}';`);
  lines.push(`export const CLI_NAME = '${name}';`);
  lines.push('');

  // loadAuth
  lines.push('export function loadAuth(): AuthConfig | null {');
  lines.push('  if (!existsSync(AUTH_FILE)) return null;');
  lines.push('  try {');
  lines.push("    const data = readFileSync(AUTH_FILE, 'utf-8');");
  lines.push('    return JSON.parse(data) as AuthConfig;');
  lines.push('  } catch {');
  lines.push('    return null;');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // saveAuth
  lines.push('export function saveAuth(config: AuthConfig): void {');
  lines.push("  writeFileSync(AUTH_FILE, JSON.stringify(config, null, 2), 'utf-8');");
  lines.push('}');
  lines.push('');

  // isAuthConfigured
  lines.push('export function isAuthConfigured(): boolean {');
  lines.push('  return existsSync(AUTH_FILE);');
  lines.push('}');
  lines.push('');

  // clearAuth
  lines.push('export function clearAuth(): void {');
  lines.push('  if (existsSync(AUTH_FILE)) {');
  lines.push('    unlinkSync(AUTH_FILE);');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// src/commands.ts
// ---------------------------------------------------------------------------

export function emitCommandsModule(
  endpoints: Endpoint[],
  _types: TypeDefinition[],
): string {
  const lines: string[] = [];

  lines.push("import { Command } from 'commander';");
  lines.push("import { loadAuth, AUTH_TYPE, CLI_NAME } from './auth.js';");
  lines.push("import { ApiClient } from './client.js';");
  lines.push('');

  lines.push('function getClient(baseUrl?: string): ApiClient {');
  lines.push('  const auth = loadAuth();');
  lines.push('  if (!auth) {');
  lines.push('    console.error(`No auth configured. Run: ${CLI_NAME} auth setup`);');
  lines.push('    process.exit(1);');
  lines.push('  }');
  lines.push('  return new ApiClient(baseUrl, auth);');
  lines.push('}');
  lines.push('');

  lines.push('function handleError(error: unknown): void {');
  lines.push('  if (error instanceof Error && \'status\' in error) {');
  lines.push('    const status = (error as { status: number }).status;');
  lines.push('    if (status === 401 || status === 403) {');
  lines.push('      console.error(`Authentication failed (${status}). Run: ${CLI_NAME} auth setup`);');
  lines.push('      process.exit(1);');
  lines.push('    }');
  lines.push('  }');
  lines.push('  console.error(error instanceof Error ? error.message : String(error));');
  lines.push('  process.exit(1);');
  lines.push('}');
  lines.push('');

  lines.push('export function registerEndpointCommands(program: Command): void {');

  for (const endpoint of endpoints) {
    const methodName = pathToMethodName(endpoint.method, endpoint.normalizedPath);
    const commandName = methodNameToCliCommand(methodName, endpoint.method);
    const description = `${endpoint.method} ${endpoint.normalizedPath}`;

    // Determine path params
    const pathSegments = endpoint.normalizedPath.split('/');
    const pathParams: { name: string; index: number }[] = [];
    for (let i = 0; i < pathSegments.length; i++) {
      if (pathSegments[i] === ':id') {
        const preceding = i > 0 ? pathSegments[i - 1] : 'item';
        const singularized = singularize(preceding);
        pathParams.push({ name: `${singularized}Id`, index: i });
      }
    }

    const hasBody = ['POST', 'PUT', 'PATCH'].includes(endpoint.method);

    // Detect GraphQL persisted query endpoints
    const qpMap = new Map(endpoint.queryParams.map((qp) => [qp.name, qp]));
    const isGraphQL = qpMap.has('operationName') && qpMap.has('extensions');

    if (isGraphQL) {
      // --- GraphQL persisted query endpoint ---
      const operationNameQp = qpMap.get('operationName')!;
      const extensionsQp = qpMap.get('extensions')!;
      const variablesQp = qpMap.get('variables');

      // Derive baked-in constants from observed values
      const bakedOperationName = operationNameQp.observedValues[0] ?? commandName;
      const bakedExtensions = extensionsQp.observedValues[0] ?? '{}';

      // Parse observed variables JSON to discover fields
      interface VarField {
        camelName: string;
        kebabName: string;
        exampleValue: string;
      }
      const varFields: VarField[] = [];

      if (variablesQp && variablesQp.observedValues.length > 0) {
        try {
          const parsed = JSON.parse(variablesQp.observedValues[0]);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [key, val] of Object.entries(parsed)) {
              const kebab = camelToKebab(key);
              const example = typeof val === 'string' ? val : JSON.stringify(val);
              varFields.push({ camelName: key, kebabName: kebab, exampleValue: example });
            }
          }
        } catch {
          // variables is not valid JSON, skip field extraction
        }
      }

      // Identify other query params that are not the GraphQL special ones
      const graphqlSpecialParams = new Set(['operationName', 'extensions', 'variables']);
      const otherParams = endpoint.queryParams.filter((qp) => !graphqlSpecialParams.has(qp.name));

      // Params that get defaults (locale, currency)
      const defaultableParams = new Map<string, string>([
        ['locale', 'en'],
        ['currency', 'USD'],
      ]);

      lines.push('');
      lines.push(`  program`);
      lines.push(`    .command('${commandName}')`);
      lines.push(`    .description('${description}')`);

      // Path params as required arguments
      for (const pp of pathParams) {
        lines.push(`    .argument('<${pp.name}>', '${pp.name} path parameter')`);
      }

      // Individual variable fields as options
      for (const vf of varFields) {
        const truncExample = vf.exampleValue.length > 50 ? vf.exampleValue.substring(0, 47) + '...' : vf.exampleValue;
        const safeExample = truncExample.replace(/'/g, "\\'");
        lines.push(`    .option('--${vf.kebabName} <value>', '${vf.camelName} variable (e.g. "${safeExample}")')`);
      }

      // Escape hatch: raw --variables JSON
      lines.push("    .option('--variables <json>', 'Raw variables JSON (overrides individual variable options)')");

      // Other params (locale, currency, etc.) with defaults where applicable
      for (const qp of otherParams) {
        const defaultVal = defaultableParams.get(qp.name);
        if (defaultVal) {
          lines.push(`    .option('--${qp.name} <value>', '${qp.name} query parameter', '${defaultVal}')`);
        } else {
          lines.push(`    .option('--${qp.name} <value>', '${qp.name} query parameter')`);
        }
      }

      lines.push("    .option('--raw', 'Output compact JSON instead of pretty-printed')");

      // Build the action handler
      const argNames = pathParams.map((pp) => pp.name);
      const actionParams = argNames.length > 0 ? argNames.join(', ') + ', options' : 'options';

      lines.push(`    .action(async (${actionParams}) => {`);
      lines.push('      try {');
      lines.push('        const client = getClient();');

      // Build variables object from individual options or raw JSON
      lines.push('        let variables: Record<string, any>;');
      lines.push('        if (options.variables) {');
      lines.push('          try {');
      lines.push('            variables = JSON.parse(options.variables);');
      lines.push('          } catch {');
      lines.push("            console.error('Invalid JSON for --variables.');");
      lines.push('            process.exit(1);');
      lines.push('          }');
      lines.push('        } else {');
      lines.push('          variables = {};');
      for (const vf of varFields) {
        // Commander converts kebab-case options to camelCase automatically
        const optionAccessor = kebabToCamel(vf.kebabName);
        lines.push(`          if (options[${JSON.stringify(optionAccessor)}] !== undefined) variables[${JSON.stringify(vf.camelName)}] = options[${JSON.stringify(optionAccessor)}];`);
      }
      lines.push('        }');

      // Build query opts with baked-in values
      lines.push('        const queryOpts: any = {};');
      lines.push(`        queryOpts.operationName = ${JSON.stringify(bakedOperationName)};`);
      lines.push(`        queryOpts.extensions = ${JSON.stringify(bakedExtensions)};`);
      lines.push('        queryOpts.variables = JSON.stringify(variables);');

      for (const qp of otherParams) {
        lines.push(`        if (options.${qp.name} !== undefined) queryOpts.${qp.name} = options.${qp.name};`);
      }

      // Build method call
      const callArgs: string[] = [...argNames];
      if (hasBody) {
        lines.push("        const bodyData = options.body || options.json || '';");
        lines.push('        let parsedBody: any;');
        lines.push('        try {');
        lines.push('          parsedBody = JSON.parse(bodyData);');
        lines.push('        } catch {');
        lines.push("          console.error('Invalid JSON body. Provide valid JSON via --body or --json.');");
        lines.push('          process.exit(1);');
        lines.push('        }');
        callArgs.push('parsedBody');
      }
      callArgs.push('queryOpts');

      lines.push(`        const result = await client.${methodName}(${callArgs.join(', ')});`);
      lines.push('        const output = options.raw ? JSON.stringify(result) : JSON.stringify(result, null, 2);');
      lines.push('        console.log(output);');
      lines.push('      } catch (error) {');
      lines.push('        handleError(error);');
      lines.push('      }');
      lines.push('    });');
    } else {
      // --- Non-GraphQL endpoint (existing behavior) ---
      const hasQueryParams = endpoint.queryParams.length > 0;

      lines.push('');
      lines.push(`  program`);
      lines.push(`    .command('${commandName}')`);
      lines.push(`    .description('${description}')`);

      // Path params as required arguments
      for (const pp of pathParams) {
        lines.push(`    .argument('<${pp.name}>', '${pp.name} path parameter')`);
      }

      // Query params as options
      if (hasQueryParams) {
        for (const qp of endpoint.queryParams) {
          lines.push(`    .option('--${qp.name} <value>', '${qp.name} query parameter')`);
        }
      }

      // Body options for POST/PUT/PATCH
      if (hasBody) {
        lines.push("    .option('--body <json>', 'Request body as JSON string')");
        lines.push("    .option('--json <json>', 'Request body as JSON string (alias for --body)')");
      }

      lines.push("    .option('--raw', 'Output compact JSON instead of pretty-printed')");

      // Build the action handler
      const argNames = pathParams.map((pp) => pp.name);
      const actionParams = argNames.length > 0 ? argNames.join(', ') + ', options' : 'options';

      lines.push(`    .action(async (${actionParams}) => {`);
      lines.push('      try {');
      lines.push('        const client = getClient();');

      // Build method call
      const callArgs: string[] = [...argNames];
      if (hasBody) {
        lines.push("        const bodyData = options.body || options.json || '';");
        lines.push('        let parsedBody: any;');
        lines.push('        try {');
        lines.push('          parsedBody = JSON.parse(bodyData);');
        lines.push('        } catch {');
        lines.push("          console.error('Invalid JSON body. Provide valid JSON via --body or --json.');");
        lines.push('          process.exit(1);');
        lines.push('        }');
        callArgs.push('parsedBody');
      }

      if (hasQueryParams) {
        lines.push('        const queryOpts: any = {};');
        for (const qp of endpoint.queryParams) {
          lines.push(`        if (options.${qp.name} !== undefined) queryOpts.${qp.name} = options.${qp.name};`);
        }
        callArgs.push('queryOpts');
      }

      lines.push(`        const result = await client.${methodName}(${callArgs.join(', ')});`);
      lines.push('        const output = options.raw ? JSON.stringify(result) : JSON.stringify(result, null, 2);');
      lines.push('        console.log(output);');
      lines.push('      } catch (error) {');
      lines.push('        handleError(error);');
      lines.push('      }');
      lines.push('    });');
    }
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// src/cli.ts
// ---------------------------------------------------------------------------

export function emitCli(
  name: string,
  endpoints: Endpoint[],
  authInfos: AuthInfo[],
  baseUrl: string,
  originalUrl: string,
): string {
  const primaryAuth = authInfos.length > 0 ? authInfos[0] : null;
  const lines: string[] = [];

  lines.push("import { Command } from 'commander';");
  lines.push("import { createInterface } from 'node:readline';");
  lines.push(
    "import { loadAuth, saveAuth, isAuthConfigured, clearAuth, AUTH_TYPE, ORIGINAL_URL, CLI_NAME } from './auth.js';\nimport type { AuthConfig } from './auth.js';",
  );
  lines.push("import { ApiClient } from './client.js';");
  lines.push("import { registerEndpointCommands } from './commands.js';");
  lines.push('');

  lines.push(`const program = new Command('${name}');`);
  lines.push(`program.version('0.1.0');`);
  lines.push(`program.description('Auto-generated CLI for ${originalUrl}');`);
  lines.push('');

  // Auth command group
  lines.push("const authCmd = program.command('auth').description('Manage authentication');");
  lines.push('');

  // Helper to parse auth from cURL or raw input
  lines.push('function parseAuthFromInput(input: string): AuthConfig | null {');
  lines.push('  const trimmed = input.trim();');
  lines.push('  // Join backslash-continued lines');
  lines.push("  const joined = trimmed.replace(/\\\\\\s*\\n/g, ' ');");
  lines.push('');
  lines.push('  // Check if it looks like a cURL command');
  lines.push("  const isCurl = /^curl\\s/i.test(joined);");
  lines.push('  if (!isCurl) return null;');
  lines.push('');
  lines.push('  const auth: AuthConfig = {};');
  lines.push('');
  lines.push('  // Extract cookie from -b flag');
  lines.push("  const bMatch = joined.match(/-b\\s+'([^']+)'/) || joined.match(/-b\\s+\"([^\"]+)\"/);");
  lines.push('  if (bMatch) auth.cookie = bMatch[1];');
  lines.push('');
  lines.push('  // Extract all -H headers');
  lines.push("  const headerPattern = /-H\\s+'([^']*)'|-H\\s+\"([^\"]*)\"/g;");
  lines.push('  const extraHeaders: Record<string, string> = {};');
  lines.push('  let hm;');
  lines.push('  while ((hm = headerPattern.exec(joined)) !== null) {');
  lines.push('    const headerStr = hm[1] || hm[2];');
  lines.push("    const colonIdx = headerStr.indexOf(':');");
  lines.push('    if (colonIdx === -1) continue;');
  lines.push('    const hName = headerStr.slice(0, colonIdx).trim();');
  lines.push('    const hValue = headerStr.slice(colonIdx + 1).trim();');
  lines.push('    const hLower = hName.toLowerCase();');
  lines.push('');
  lines.push('    // Cookie header');
  lines.push("    if (hLower === 'cookie') { auth.cookie = hValue; continue; }");
  lines.push('    // Bearer token');
  lines.push("    if (hLower === 'authorization' && hValue.toLowerCase().startsWith('bearer ')) {");
  lines.push("      auth.token = hValue.replace(/^[Bb]earer\\s+/, ''); continue;");
  lines.push('    }');
  lines.push('    // Interesting extra headers to preserve');
  lines.push("    if (hLower.startsWith('x-') && hValue && !hLower.startsWith('x-client-') && hLower !== 'x-csrf-without-token') {");
  lines.push('      extraHeaders[hName] = hValue;');
  lines.push('    }');
  lines.push('  }');
  lines.push('');
  lines.push('  if (Object.keys(extraHeaders).length > 0) auth.extraHeaders = extraHeaders;');
  lines.push('  if (!auth.cookie && !auth.token && !auth.apiKey) return null;');
  lines.push('  return auth;');
  lines.push('}');
  lines.push('');

  // auth setup
  lines.push("authCmd.command('setup')");
  lines.push("  .description('Configure authentication from a cURL command')");
  lines.push("  .option('-f, --file <path>', 'Read cURL command from a file')");
  lines.push('  .action(async (options: { file?: string }) => {');
  lines.push("    let input: string;");
  lines.push('');
  lines.push('    if (options.file) {');
  lines.push("      const { readFileSync } = await import('node:fs');");
  lines.push("      input = readFileSync(options.file, 'utf-8');");
  lines.push('    } else if (!process.stdin.isTTY) {');
  lines.push('      // Piped input: cat curl.txt | airbnb auth setup');
  lines.push("      const chunks: string[] = [];");
  lines.push("      process.stdin.setEncoding('utf8');");
  lines.push('      for await (const chunk of process.stdin) { chunks.push(chunk as string); }');
  lines.push("      input = chunks.join('');");
  lines.push('    } else {');
  lines.push('      console.log(\'\');');
  lines.push(`      console.log('To set up auth, copy a cURL command from Chrome DevTools:');`);
  lines.push(`      console.log('  1. Open ' + ORIGINAL_URL + ' in your browser (make sure you are logged in)');`);
  lines.push(`      console.log('  2. Open DevTools (F12) -> Network tab');`);
  lines.push(`      console.log('  3. Right-click any API request -> Copy -> Copy as cURL');`);
  lines.push(`      console.log('  4. Save it to a file, then run:');`);
  lines.push('      console.log(\'\');');
  lines.push(`      console.log('    ' + CLI_NAME + ' auth setup --file curl.txt');`);
  lines.push('      console.log(\'\');');
  lines.push(`      console.log('  Or pipe it directly:');`);
  lines.push('      console.log(\'\');');
  lines.push(`      console.log('    pbpaste | ' + CLI_NAME + ' auth setup');`);
  lines.push('      console.log(\'\');');
  lines.push('      process.exit(0);');
  lines.push('    }');
  lines.push('');
  lines.push("    if (!input.trim()) { console.error('No input provided.'); process.exit(1); }");
  lines.push('');
  lines.push('    const parsed = parseAuthFromInput(input);');
  lines.push('    if (parsed) {');
  lines.push('      saveAuth(parsed);');
  lines.push("      const parts: string[] = [];");
  lines.push("      if (parsed.cookie) parts.push('cookie');");
  lines.push("      if (parsed.token) parts.push('bearer token');");
  lines.push("      if (parsed.apiKey) parts.push('API key');");
  lines.push("      if (parsed.extraHeaders) parts.push(Object.keys(parsed.extraHeaders).length + ' extra header(s)');");
  lines.push("      console.log('Auth saved. Extracted: ' + parts.join(', '));");
  lines.push('    } else {');
  lines.push("      console.error('Could not parse auth from input. Make sure it is a valid cURL command with -b or -H Cookie header.');");
  lines.push('      process.exit(1);');
  lines.push('    }');
  lines.push('  });');
  lines.push('');

  // auth status
  lines.push("authCmd.command('status')");
  lines.push("  .description('Check if authentication is configured')");
  lines.push('  .action(async () => {');
  lines.push('    if (!isAuthConfigured()) {');
  lines.push("      console.log('Not configured. Run: ' + CLI_NAME + ' auth setup');");
  lines.push('      return;');
  lines.push('    }');
  lines.push("    console.log('Auth is configured (.auth file exists).');");
  lines.push('    const auth = loadAuth();');
  lines.push('    if (!auth) {');
  lines.push("      console.log('Warning: .auth file exists but could not be parsed.');");
  lines.push('      return;');
  lines.push('    }');
  lines.push("    if (auth.cookie) console.log('  Type: cookie');");
  lines.push("    if (auth.token) console.log('  Type: bearer token');");
  lines.push("    if (auth.apiKey) console.log('  Type: API key');");
  lines.push('');
  lines.push('    // Health check');
  lines.push(`    const client = new ApiClient('${baseUrl}', auth);`);
  lines.push('    try {');
  lines.push('      const result = await client.healthCheck();');
  lines.push("      if (result.valid) { console.log('  Status: valid'); }");
  lines.push("      else { console.log('  Status: ' + result.message); }");
  lines.push('    } catch {');
  lines.push("      console.log('  Status: could not verify');");
  lines.push('    }');
  lines.push('  });');
  lines.push('');

  // auth clear
  lines.push("authCmd.command('clear')");
  lines.push("  .description('Remove stored authentication credentials')");
  lines.push('  .action(() => {');
  lines.push('    clearAuth();');
  lines.push("    console.log('Auth cleared.');");
  lines.push('  });');
  lines.push('');

  // Register endpoint commands
  lines.push('registerEndpointCommands(program);');
  lines.push('');

  // Parse
  lines.push('program.parse();');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// README.md
// ---------------------------------------------------------------------------

export function emitProjectReadme(
  name: string,
  endpoints: Endpoint[],
  authInfos: AuthInfo[],
  originalUrl: string,
): string {
  const primaryAuth = authInfos.length > 0 ? authInfos[0] : null;
  const lines: string[] = [];

  lines.push(`# ${name}`);
  lines.push('');
  lines.push(`Auto-generated CLI for the API at ${originalUrl}.`);
  lines.push('');

  lines.push('## Setup');
  lines.push('');
  lines.push('```bash');
  lines.push('npm install');
  lines.push('npm run build');
  lines.push('```');
  lines.push('');

  lines.push('## Authentication');
  lines.push('');
  if (primaryAuth?.type === 'cookie') {
    lines.push('This API uses cookie-based authentication. Run:');
  } else if (primaryAuth?.type === 'bearer') {
    lines.push('This API uses bearer token authentication. Run:');
  } else if (primaryAuth?.type === 'api-key') {
    lines.push('This API uses API key authentication. Run:');
  } else {
    lines.push('Configure authentication by running:');
  }
  lines.push('');
  lines.push('```bash');
  lines.push(`${name} auth setup`);
  lines.push('```');
  lines.push('');

  lines.push('## Commands');
  lines.push('');
  const exampleEndpoints = endpoints.slice(0, 5);
  for (const ep of exampleEndpoints) {
    const methodName = pathToMethodName(ep.method, ep.normalizedPath);
    const cmd = methodNameToCliCommand(methodName, ep.method);
    lines.push(`- \`${name} ${cmd}\` -- ${ep.method} ${ep.normalizedPath}`);
  }
  if (endpoints.length > 5) {
    lines.push(`- ... and ${endpoints.length - 5} more`);
  }
  lines.push('');
  lines.push(`Run \`${name} --help\` to see all available commands.`);
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('Generated by [api-creator](https://github.com/anthropics/api-creator).');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Convert camelCase to kebab-case: "listingId" → "listing-id" */
function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Convert kebab-case to camelCase: "listing-id" → "listingId" */
function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
