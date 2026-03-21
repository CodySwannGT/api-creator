/**
 * Manages project storage under ./services/<name>/ and auth under ~/.api-creator/.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { AuthConfig } from "./curl-parser.js";

const API_CREATOR_DIR = ".api-creator";
const SERVICES_DIR = "services";

// ── Manifest types ──────────────────────────────────────────────────────

/**
 * A single GraphQL variable field definition in a manifest endpoint.
 */
export interface VariableField {
  camelName: string;
  kebabName: string;
  exampleValue: string;
}

/**
 * A single endpoint entry in the project manifest, describing the CLI command
 * and HTTP request details needed to call it.
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

  group?: string;
}

/**
 * The top-level project manifest, describing the API and all its endpoints.
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
 * Returns the root directory where all api-creator projects are stored.
 * @returns the absolute path to the services directory
 */
export function getProjectsDir(): string {
  return resolve(SERVICES_DIR);
}

/**
 * Returns the directory where HAR recordings are stored.
 * @returns the absolute path to the recordings directory
 */
export function getRecordingsDir(): string {
  return join(homedir(), API_CREATOR_DIR, "recordings");
}

/**
 * Returns the directory for a specific project by name.
 * @param name - the project name
 * @returns the absolute path to the project directory
 */
export function getProjectDir(name: string): string {
  return join(getProjectsDir(), name);
}

/**
 * Lists all project names found in the projects directory.
 * @returns an array of project name strings, or empty if none found
 */
export function listProjects(): string[] {
  const dir = getProjectsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

/**
 * Loads and parses the manifest for a given project.
 * @param name - the project name to load
 * @returns the parsed ProjectManifest, or null if not found or invalid
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
 * Saves the project manifest to disk, creating the project directory if needed.
 * @param name - the project name
 * @param manifest - the ProjectManifest to serialize and save
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

// ── Manifest merging ────────────────────────────────────────────────────

/**
 * Merges an existing manifest with an incoming one. New endpoints override
 * existing ones by commandName; existing-only endpoints are preserved.
 * @param existing - the previously saved manifest
 * @param incoming - the newly generated manifest from HAR
 * @returns the merged manifest
 */
export function mergeManifests(
  existing: ProjectManifest,
  incoming: ProjectManifest
): ProjectManifest {
  const existingByCommand = existing.endpoints.reduce(
    (acc, ep) => ({ ...acc, [ep.commandName]: ep }),
    {} as Record<string, ManifestEndpoint>
  );
  const incomingByCommand = incoming.endpoints.reduce(
    (acc, ep) => ({ ...acc, [ep.commandName]: ep }),
    {} as Record<string, ManifestEndpoint>
  );

  const merged = { ...existingByCommand, ...incomingByCommand };

  return { ...incoming, endpoints: Object.values(merged) };
}

// ── Auth storage ────────────────────────────────────────────────────────
// Auth is stored at ~/.api-creator/<name>.auth (outside the project dir)
// so it's easy to find and manage globally.

/**
 * Returns the path to the auth file for a given project.
 * @param name - the project name
 * @returns the absolute path to the auth file
 */
function getAuthPath(name: string): string {
  return join(homedir(), API_CREATOR_DIR, `${name}.auth`);
}

/**
 * Loads and parses the auth config for a given project.
 * @param name - the project name to load auth for
 * @returns the parsed AuthConfig, or null if not found or invalid
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
 * Saves auth credentials to disk for a given project.
 * @param name - the project name
 * @param config - the AuthConfig to serialize and save
 */
export function saveAuth(name: string, config: AuthConfig): void {
  const dir = join(homedir(), API_CREATOR_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(getAuthPath(name), JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Removes stored auth credentials for a given project.
 * @param name - the project name whose auth to clear
 */
export function clearAuth(name: string): void {
  const authPath = getAuthPath(name);
  if (existsSync(authPath)) {
    unlinkSync(authPath);
  }
}
