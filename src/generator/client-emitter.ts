import type { Endpoint } from '../types/endpoint.js';
import type { AuthInfo } from '../types/auth.js';
import type { TypeDefinition } from '../parser/type-inferrer.js';
import { pathToMethodName, pathToTypeName } from '../utils/naming.js';

export interface EmitClientOptions {
  endpoints: Endpoint[];
  types: TypeDefinition[];
  requestTypes: TypeDefinition[];
  auth: AuthInfo[];
  baseUrl: string;
  name?: string;
  originalUrl?: string;
}

export function emitClient(options: EmitClientOptions): string {
  const {
    endpoints,
    types,
    requestTypes,
    auth,
    baseUrl,
    name,
    originalUrl,
  } = options;

  const className = name ?? 'ApiClient';
  const primaryAuth = auth.length > 0 ? auth[0] : null;

  const lines: string[] = [];

  // Imports from types
  const typeNames = collectTypeImports(endpoints, types, requestTypes);
  if (typeNames.length > 0) {
    lines.push(`import type { ${typeNames.join(', ')} } from './types.js';`);
    lines.push('');
  }

  // SESSION_HELP constant
  lines.push('export const SESSION_HELP =');
  lines.push("  'Your session token may have expired. ' +");
  lines.push("  'To renew: log in to the web application in your browser, ' +");
  lines.push("  'copy the new token from the request headers (or cookies), ' +");
  lines.push("  'and pass it to the client constructor.';");
  lines.push('');

  // ApiError class
  lines.push('export class ApiError extends Error {');
  lines.push('  status: number;');
  lines.push('  body: unknown;');
  lines.push('');
  lines.push('  constructor(status: number, body: unknown) {');
  lines.push('    const hint = status === 401 || status === 403 ? ` — ${SESSION_HELP}` : \'\';');
  lines.push('    super(`API request failed with status ${status}${hint}`);');
  lines.push("    this.name = 'ApiError';");
  lines.push('    this.status = status;');
  lines.push('    this.body = body;');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // Auth config type
  lines.push('export interface AuthConfig {');
  lines.push('  token?: string;');
  lines.push('  cookie?: string;');
  lines.push('  apiKey?: string;');
  lines.push('  extraHeaders?: Record<string, string>;');
  lines.push('}');
  lines.push('');

  // Health check result type
  lines.push('export interface HealthCheckResult {');
  lines.push('  valid: boolean;');
  lines.push('  status: number;');
  lines.push('  message: string;');
  lines.push('}');
  lines.push('');

  // Class JSDoc
  const urlNote = originalUrl ? ` Originally captured from ${originalUrl}.` : '';
  lines.push('/**');
  lines.push(` * ${className} — auto-generated typed API client.${urlNote}`);
  lines.push(' *');
  if (primaryAuth) {
    lines.push(` * Authentication: ${primaryAuth.type} (${primaryAuth.location}: ${primaryAuth.key})`);
    lines.push(' *');
  }
  lines.push(' * If you receive 401/403 errors, your session token has likely expired.');
  lines.push(' * To renew: log in to the web application in your browser, copy the');
  lines.push(' * updated token from the request headers (or cookies), and pass it to');
  lines.push(' * the constructor.');
  lines.push(' */');

  // Class declaration
  lines.push(`export class ${className} {`);
  lines.push('  private baseUrl: string;');
  lines.push('  private auth: AuthConfig;');
  lines.push('');

  // Constructor
  lines.push(`  constructor(baseUrl: string = '${baseUrl}', auth: AuthConfig = {}) {`);
  lines.push("    this.baseUrl = baseUrl.replace(/\\/+$/, '');");
  lines.push('    this.auth = auth;');
  lines.push('  }');
  lines.push('');

  // _fetch helper
  emitFetchHelper(lines, primaryAuth);

  // healthCheck method
  emitHealthCheck(lines, endpoints);

  // Endpoint methods
  for (const endpoint of endpoints) {
    emitEndpointMethod(lines, endpoint, types, requestTypes);
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function collectTypeImports(
  endpoints: Endpoint[],
  types: TypeDefinition[],
  requestTypes: TypeDefinition[],
): string[] {
  const typeNameSet = new Set<string>();
  const allTypeNames = new Set([
    ...types.map((t) => t.name),
    ...requestTypes.map((t) => t.name),
  ]);

  for (const endpoint of endpoints) {
    const responseTypeName = pathToTypeName(endpoint.method, endpoint.normalizedPath);
    const requestTypeName = responseTypeName.replace(/Response$/, 'Request');

    if (allTypeNames.has(responseTypeName)) {
      typeNameSet.add(responseTypeName);
      // Also collect nested types used by this type
      collectNestedImports(responseTypeName, types, typeNameSet);
    }
    if (allTypeNames.has(requestTypeName)) {
      typeNameSet.add(requestTypeName);
      collectNestedImports(requestTypeName, requestTypes, typeNameSet);
    }
  }

  return [...typeNameSet].sort();
}

function collectNestedImports(
  typeName: string,
  allTypes: TypeDefinition[],
  collected: Set<string>,
): void {
  const typeDef = allTypes.find((t) => t.name === typeName);
  if (!typeDef) return;

  for (const prop of typeDef.properties) {
    if (prop.nestedType && !collected.has(prop.nestedType.name)) {
      collected.add(prop.nestedType.name);
      collectNestedImports(prop.nestedType.name, allTypes, collected);
    }
  }
}

function emitFetchHelper(lines: string[], primaryAuth: AuthInfo | null): void {
  lines.push('  private async _fetch(path: string, init: RequestInit = {}): Promise<Response> {');
  lines.push('    const headers = new Headers(init.headers);');
  lines.push('');

  if (primaryAuth) {
    switch (primaryAuth.type) {
      case 'bearer':
        lines.push('    if (this.auth.token) {');
        lines.push('      headers.set(\'Authorization\', `Bearer ${this.auth.token}`);');
        lines.push('    }');
        break;
      case 'cookie':
        lines.push('    if (this.auth.cookie) {');
        lines.push("      headers.set('Cookie', this.auth.cookie);");
        lines.push('    }');
        break;
      case 'api-key':
        lines.push('    if (this.auth.apiKey) {');
        lines.push(`      headers.set('${primaryAuth.key}', this.auth.apiKey);`);
        lines.push('    }');
        break;
      default:
        // For query-param, custom-header, etc. — add a generic token header
        lines.push('    if (this.auth.token) {');
        lines.push("      headers.set('Authorization', `Bearer ${this.auth.token}`);");
        lines.push('    }');
        break;
    }
  } else {
    // No detected auth — still support bearer token as a default
    lines.push('    if (this.auth.token) {');
    lines.push('      headers.set(\'Authorization\', `Bearer ${this.auth.token}`);');
    lines.push('    }');
    lines.push('    if (this.auth.cookie) {');
    lines.push("      headers.set('Cookie', this.auth.cookie);");
    lines.push('    }');
    lines.push('    if (this.auth.apiKey) {');
    lines.push("      headers.set('X-API-Key', this.auth.apiKey);");
    lines.push('    }');
  }

  lines.push('');
  lines.push('    // Apply any extra headers from auth config');
  lines.push('    if (this.auth.extraHeaders) {');
  lines.push('      for (const [key, value] of Object.entries(this.auth.extraHeaders)) {');
  lines.push('        headers.set(key, value);');
  lines.push('      }');
  lines.push('    }');
  lines.push('');
  lines.push('    const response = await fetch(`${this.baseUrl}${path}`, {');
  lines.push('      ...init,');
  lines.push('      headers,');
  lines.push('    });');
  lines.push('');
  lines.push('    return response;');
  lines.push('  }');
  lines.push('');
}

function emitHealthCheck(lines: string[], endpoints: Endpoint[]): void {
  // Find the most common GET endpoint for the health check
  const getEndpoints = endpoints.filter((e) => e.method === 'GET');
  const healthPath = getEndpoints.length > 0
    ? getEndpoints.reduce((best, ep) =>
        ep.originalUrls.length > best.originalUrls.length ? ep : best,
      ).normalizedPath
    : '/';

  // Replace :id placeholders with a dummy value for health check
  const safePath = healthPath.replace(/:id/g, '1');

  lines.push('  async healthCheck(): Promise<HealthCheckResult> {');
  lines.push('    try {');
  lines.push(`      const response = await this._fetch('${safePath}', { method: 'HEAD' });`);
  lines.push('      if (response.status === 401 || response.status === 403) {');
  lines.push('        return { valid: false, status: response.status, message: SESSION_HELP };');
  lines.push('      }');
  lines.push('      return {');
  lines.push('        valid: response.ok,');
  lines.push('        status: response.status,');
  lines.push("        message: response.ok ? 'OK' : `Unexpected status ${response.status}`,");
  lines.push('      };');
  lines.push('    } catch (error) {');
  lines.push('      return {');
  lines.push('        valid: false,');
  lines.push('        status: 0,');
  lines.push('        message: error instanceof Error ? error.message : String(error),');
  lines.push('      };');
  lines.push('    }');
  lines.push('  }');
  lines.push('');
}

function emitEndpointMethod(
  lines: string[],
  endpoint: Endpoint,
  types: TypeDefinition[],
  requestTypes: TypeDefinition[],
): void {
  const methodName = pathToMethodName(endpoint.method, endpoint.normalizedPath);
  const responseTypeName = pathToTypeName(endpoint.method, endpoint.normalizedPath);
  const requestTypeName = responseTypeName.replace(/Response$/, 'Request');

  const hasResponseType = types.some((t) => t.name === responseTypeName);
  const hasRequestType = requestTypes.some((t) => t.name === requestTypeName);
  const responseType = hasResponseType ? responseTypeName : 'unknown';

  // Find the TypeDefinition for the response to check if it's an array
  const responseTypeDef = types.find((t) => t.name === responseTypeName);
  const actualReturnType = responseTypeDef?.isArray && responseTypeDef.properties.length > 0
    ? `${responseTypeName}[]`
    : (responseTypeDef?.isArray ? 'unknown[]' : responseType);

  // Determine parameters
  const params: string[] = [];

  // Path params (extract :id segments)
  const pathSegments = endpoint.normalizedPath.split('/');
  const pathParamSegments: { index: number; paramName: string }[] = [];
  for (let i = 0; i < pathSegments.length; i++) {
    if (pathSegments[i] === ':id') {
      // Derive param name from the preceding segment
      const preceding = i > 0 ? pathSegments[i - 1] : 'item';
      const singularized = singularize(preceding);
      const paramName = `${singularized}Id`;
      pathParamSegments.push({ index: i, paramName });
    }
  }

  // If there are multiple :id params, make their names unique
  const seenParams = new Set<string>();
  for (const pp of pathParamSegments) {
    let name = pp.paramName;
    if (seenParams.has(name)) {
      name = `${name}${seenParams.size + 1}`;
    }
    seenParams.add(name);
    pp.paramName = name;
    params.push(`${name}: string`);
  }

  // Body param for POST/PUT/PATCH
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(endpoint.method);
  if (hasBody) {
    const bodyType = hasRequestType ? requestTypeName : 'Record<string, unknown>';
    params.push(`body: ${bodyType}`);
  }

  // Query params as optional options object
  if (endpoint.queryParams.length > 0) {
    const queryProps = endpoint.queryParams
      .map((qp) => `${qp.name}${qp.required ? '' : '?'}: string`)
      .join('; ');
    params.push(`options?: { ${queryProps} }`);
  }

  const paramStr = params.join(', ');

  // Build the path expression
  let pathExpr: string;
  if (pathParamSegments.length > 0) {
    const pathParts = [...pathSegments];
    for (const pp of pathParamSegments) {
      pathParts[pp.index] = `\${${pp.paramName}}`;
    }
    pathExpr = '`' + pathParts.join('/') + '`';
  } else {
    pathExpr = `'${endpoint.normalizedPath}'`;
  }

  // Method
  lines.push(`  async ${methodName}(${paramStr}): Promise<${actualReturnType}> {`);

  // Query string
  if (endpoint.queryParams.length > 0) {
    lines.push('    const params = new URLSearchParams();');
    lines.push('    if (options) {');
    for (const qp of endpoint.queryParams) {
      lines.push(`      if (options.${qp.name} !== undefined) params.set('${qp.name}', options.${qp.name});`);
    }
    lines.push('    }');
    lines.push("    const qs = params.toString() ? `?${params.toString()}` : '';");
    lines.push(`    const response = await this._fetch(${pathExpr} + qs, {`);
  } else {
    lines.push(`    const response = await this._fetch(${pathExpr}, {`);
  }

  lines.push(`      method: '${endpoint.method}',`);
  if (hasBody) {
    lines.push("      headers: { 'Content-Type': 'application/json' },");
    lines.push('      body: JSON.stringify(body),');
  }
  lines.push('    });');
  lines.push('');
  lines.push('    if (!response.ok) {');
  lines.push('      const errorBody = await response.text().catch(() => \'\');');
  lines.push('      throw new ApiError(response.status, errorBody);');
  lines.push('    }');
  lines.push('');
  lines.push('    return response.json();');
  lines.push('  }');
  lines.push('');
}

/**
 * Naive singularization: remove trailing 's' if present.
 */
function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
