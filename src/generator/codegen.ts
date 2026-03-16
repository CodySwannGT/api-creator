import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';

import { readHarFile, filterApiRequests } from '../parser/har-reader.js';
import { groupEndpoints } from '../parser/endpoint-grouper.js';
import { detectAuth } from '../parser/auth-detector.js';
import { inferTypes, inferRequestTypes } from '../parser/type-inferrer.js';
import { emitClient } from './client-emitter.js';
import { emitTypes } from './types-emitter.js';
import { pathToMethodName, methodNameToCliCommand } from '../utils/naming.js';
import {
  saveManifest,
  getProjectDir,
} from '../runtime/project-manager.js';
import type {
  ProjectManifest,
  ManifestEndpoint,
  VariableField,
} from '../runtime/project-manager.js';
import type { Endpoint } from '../types/endpoint.js';
import type { AuthInfo } from '../types/auth.js';

export interface GenerateOptions {
  inputPath: string;
  name?: string;
  baseUrl?: string;
}

export async function generateClient(options: GenerateOptions): Promise<void> {
  const { inputPath, name, baseUrl } = options;

  // 1. Read HAR file
  const entries = await readHarFile(inputPath);
  console.log(chalk.gray(`  Read ${entries.length} entries from HAR file`));

  // 2. Filter API requests
  const apiEntries = filterApiRequests(entries);
  console.log(chalk.gray(`  Found ${apiEntries.length} API requests`));

  if (apiEntries.length === 0) {
    console.log(chalk.yellow('  No API requests found in the HAR file.'));
    return;
  }

  // 3. Detect auth
  const auth = detectAuth(apiEntries);
  if (auth.length > 0) {
    console.log(chalk.gray(`  Detected auth: ${auth[0].type} (${auth[0].key})`));
  }

  // 4. Group endpoints
  const { baseUrl: detectedBaseUrl, endpoints } = groupEndpoints(apiEntries);
  const resolvedBaseUrl = baseUrl ?? detectedBaseUrl;
  console.log(chalk.gray(`  Grouped into ${endpoints.length} endpoints (base: ${resolvedBaseUrl})`));

  // 5. Infer types
  const types = inferTypes(endpoints);
  const requestTypes = inferRequestTypes(endpoints);
  console.log(chalk.gray(`  Inferred ${types.length} response types, ${requestTypes.length} request types`));

  // 6. Build manifest
  const projectName = name ?? 'api-client';
  const manifest = buildManifest(projectName, resolvedBaseUrl, detectedBaseUrl, auth, endpoints);

  // 7. Save manifest
  saveManifest(projectName, manifest);

  // 8. Generate client.ts and types.ts for programmatic use
  const clientName = 'ApiClient';
  const clientSource = emitClient({
    endpoints,
    types,
    requestTypes,
    auth,
    baseUrl: resolvedBaseUrl,
    name: clientName,
    originalUrl: detectedBaseUrl,
  });
  const typesSource = emitTypes(types, requestTypes);

  const projectDir = getProjectDir(projectName);
  await writeFile(join(projectDir, 'client.ts'), clientSource, 'utf-8');
  await writeFile(join(projectDir, 'types.ts'), typesSource, 'utf-8');

  // 9. Log summary
  console.log('');
  console.log(chalk.green.bold('  Project generated successfully!'));
  console.log('');
  console.log(chalk.white(`    ${join(projectDir, 'manifest.json')}`));
  console.log(chalk.white(`    ${join(projectDir, 'client.ts')}`));
  console.log(chalk.white(`    ${join(projectDir, 'types.ts')}`));
  console.log('');
  console.log(chalk.gray(`  ${endpoints.length} endpoints | ${types.length + requestTypes.length} types | auth: ${auth.length > 0 ? auth[0].type : 'none'}`));
  console.log('');
  console.log(chalk.cyan('  Next steps:'));
  console.log(chalk.cyan(`    api-creator ${projectName} auth setup --file curl.txt`));
  console.log(chalk.cyan(`    pbpaste | api-creator ${projectName} auth setup`));
  console.log('');
  console.log(chalk.gray(`  TypeScript client saved to ${projectDir}`));
  console.log('');
}

// ── Manifest builder ────────────────────────────────────────────────────

function buildManifest(
  projectName: string,
  baseUrl: string,
  originalUrl: string,
  authInfos: AuthInfo[],
  endpoints: Endpoint[],
): ProjectManifest {
  const authType = authInfos.length > 0 ? authInfos[0].type : 'none';

  const manifestEndpoints: ManifestEndpoint[] = endpoints.map((ep) =>
    buildManifestEndpoint(ep),
  );

  return {
    name: projectName,
    baseUrl,
    originalUrl,
    createdAt: new Date().toISOString(),
    authType,
    endpoints: manifestEndpoints,
  };
}

function buildManifestEndpoint(endpoint: Endpoint): ManifestEndpoint {
  const methodName = pathToMethodName(endpoint.method, endpoint.normalizedPath);
  const commandName = methodNameToCliCommand(methodName, endpoint.method);
  const description = `${endpoint.method} ${endpoint.normalizedPath}`;

  // Path params
  const pathSegments = endpoint.normalizedPath.split('/');
  const pathParams: string[] = [];
  for (let i = 0; i < pathSegments.length; i++) {
    if (pathSegments[i] === ':id') {
      const preceding = i > 0 ? pathSegments[i - 1] : 'item';
      const singularized = singularize(preceding);
      pathParams.push(`${singularized}Id`);
    }
  }

  const hasBody = ['POST', 'PUT', 'PATCH'].includes(endpoint.method);

  // Detect GraphQL persisted query endpoints
  const qpMap = new Map(endpoint.queryParams.map((qp) => [qp.name, qp]));
  const isGraphQL = qpMap.has('operationName') && qpMap.has('extensions');

  if (isGraphQL) {
    return buildGraphQLManifestEndpoint(
      endpoint,
      commandName,
      description,
      methodName,
      pathParams,
      hasBody,
      qpMap,
    );
  }

  // Non-GraphQL endpoint
  const queryParams = endpoint.queryParams.map((qp) => ({
    name: qp.name,
    defaultValue: undefined as string | undefined,
  }));

  return {
    commandName,
    description,
    methodName,
    httpMethod: endpoint.method,
    path: endpoint.normalizedPath,
    pathParams,
    isGraphQL: false,
    queryParams,
    hasBody,
  };
}

function buildGraphQLManifestEndpoint(
  endpoint: Endpoint,
  commandName: string,
  description: string,
  methodName: string,
  pathParams: string[],
  hasBody: boolean,
  qpMap: Map<string, { name: string; observedValues: string[]; required: boolean }>,
): ManifestEndpoint {
  const operationNameQp = qpMap.get('operationName')!;
  const extensionsQp = qpMap.get('extensions')!;
  const variablesQp = qpMap.get('variables');

  const operationName = operationNameQp.observedValues[0] ?? commandName;
  const extensions = extensionsQp.observedValues[0] ?? '{}';

  // Parse variable fields from observed values
  const variables: VariableField[] = [];
  if (variablesQp && variablesQp.observedValues.length > 0) {
    try {
      const parsed = JSON.parse(variablesQp.observedValues[0]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, val] of Object.entries(parsed)) {
          const kebab = camelToKebab(key);
          const example = typeof val === 'string' ? val : JSON.stringify(val);
          variables.push({ camelName: key, kebabName: kebab, exampleValue: example });
        }
      }
    } catch {
      // variables is not valid JSON, skip field extraction
    }
  }

  // Other query params (not the GraphQL special ones)
  const graphqlSpecialParams = new Set(['operationName', 'extensions', 'variables']);
  const otherParams = endpoint.queryParams
    .filter((qp) => !graphqlSpecialParams.has(qp.name))
    .map((qp) => {
      const defaultableParams: Record<string, string> = {
        locale: 'en',
        currency: 'USD',
      };
      return {
        name: qp.name,
        defaultValue: defaultableParams[qp.name] as string | undefined,
      };
    });

  return {
    commandName,
    description,
    methodName,
    httpMethod: endpoint.method,
    path: endpoint.normalizedPath,
    pathParams,
    isGraphQL: true,
    operationName,
    extensions,
    variables,
    queryParams: otherParams,
    hasBody,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
