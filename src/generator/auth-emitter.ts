import type { AuthInfo } from "../types/auth.js";

/** Auth type string used in the generated auth module constants. */
type AuthType = "cookie" | "bearer" | "api-key" | "none";

/**
 * Resolves the primary auth type from a list of detected auth mechanisms.
 * @param authInfos - detected auth mechanisms from recorded traffic
 * @returns the primary auth type string, or "none" if not detected
 */
function resolveAuthType(authInfos: AuthInfo[]): AuthType {
  const primary = authInfos.length > 0 ? authInfos[0] : null;
  return (primary?.type ?? "none") as AuthType;
}

/**
 * Generates the auth module source code for a CLI project,
 * including auth config types and CRUD operations for stored credentials.
 * @param authInfos - detected auth mechanisms from recorded traffic
 * @param originalUrl - the original URL the CLI was generated from
 * @param name - the CLI project name
 * @returns the generated auth module source code
 */
export function emitAuthModule(
  authInfos: AuthInfo[],
  originalUrl: string,
  name: string
): string {
  const authType = resolveAuthType(authInfos);

  return [
    "import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "",
    "export interface AuthConfig {",
    "  cookie?: string;",
    "  token?: string;",
    "  apiKey?: string;",
    "  extraHeaders?: Record<string, string>;",
    "}",
    "",
    "export const AUTH_FILE = join(process.cwd(), '.auth');",
    "",
    `/** Detected auth type: ${authType} */`,
    `export const AUTH_TYPE = '${authType}' as const;`,
    `export const ORIGINAL_URL = '${originalUrl}';`,
    `export const CLI_NAME = '${name}';`,
    "",
    "export function loadAuth(): AuthConfig | null {",
    "  if (!existsSync(AUTH_FILE)) return null;",
    "  try {",
    "    const data = readFileSync(AUTH_FILE, 'utf-8');",
    "    return JSON.parse(data) as AuthConfig;",
    "  } catch {",
    "    return null;",
    "  }",
    "}",
    "",
    "export function saveAuth(config: AuthConfig): void {",
    "  writeFileSync(AUTH_FILE, JSON.stringify(config, null, 2), 'utf-8');",
    "}",
    "",
    "export function isAuthConfigured(): boolean {",
    "  return existsSync(AUTH_FILE);",
    "}",
    "",
    "export function clearAuth(): void {",
    "  if (existsSync(AUTH_FILE)) {",
    "    unlinkSync(AUTH_FILE);",
    "  }",
    "}",
    "",
  ].join("\n");
}
