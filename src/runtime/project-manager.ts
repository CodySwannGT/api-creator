/**
 * Manages project storage under ~/.api-creator/projects/<name>/.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AuthConfig } from "./curl-parser.js";

// ── Manifest types ──────────────────────────────────────────────────────

/**
 *
 */
export interface VariableField {
  camelName: string;
  kebabName: string;
  exampleValue: string;
}

/**
 *
 */
export interface ManifestEndpoint {
  commandName: string;
  description: string;
  methodName: string;
  httpMethod: string;
  path: string;
  pathParams: string[];

  isGraphQL: boolean;
  operationName?: string;
  extensions?: string;
  variables?: VariableField[];

  queryParams: { name: string; defaultValue?: string }[];

  hasBody: boolean;
}

/**
 *
 */
export interface ProjectManifest {
  name: string;
  baseUrl: string;
  originalUrl: string;
  createdAt: string;
  authType: string;
  endpoints: ManifestEndpoint[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 *
 */
export function getProjectsDir(): string {
  return join(homedir(), ".api-creator", "projects");
}

/**
 *
 * @param name
 */
export function getProjectDir(name: string): string {
  return join(getProjectsDir(), name);
}

/**
 *
 */
export function listProjects(): string[] {
  const dir = getProjectsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

/**
 *
 * @param name
 */
export function loadManifest(name: string): ProjectManifest | null {
  const manifestPath = join(getProjectDir(name), "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const data = readFileSync(manifestPath, "utf-8");
    return JSON.parse(data) as ProjectManifest;
  } catch {
    return null;
  }
}

/**
 *
 * @param name
 * @param manifest
 */
export function saveManifest(name: string, manifest: ProjectManifest): void {
  const dir = getProjectDir(name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
}

// ── Auth storage ────────────────────────────────────────────────────────
// Auth is stored at ~/.api-creator/<name>.auth (outside the project dir)
// so it's easy to find and manage globally.

/**
 *
 * @param name
 */
function getAuthPath(name: string): string {
  return join(homedir(), ".api-creator", `${name}.auth`);
}

/**
 *
 * @param name
 */
export function loadAuth(name: string): AuthConfig | null {
  const authPath = getAuthPath(name);
  if (!existsSync(authPath)) return null;
  try {
    const data = readFileSync(authPath, "utf-8");
    return JSON.parse(data) as AuthConfig;
  } catch {
    return null;
  }
}

/**
 *
 * @param name
 * @param config
 */
export function saveAuth(name: string, config: AuthConfig): void {
  const dir = join(homedir(), ".api-creator");
  mkdirSync(dir, { recursive: true });
  writeFileSync(getAuthPath(name), JSON.stringify(config, null, 2), "utf-8");
}

/**
 *
 * @param name
 */
export function clearAuth(name: string): void {
  const authPath = getAuthPath(name);
  if (existsSync(authPath)) {
    unlinkSync(authPath);
  }
}
