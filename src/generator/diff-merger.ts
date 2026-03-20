import type { Endpoint } from "../types/endpoint.js";
import type { TypeDefinition } from "../parser/type-inferrer.js";

import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { pathToMethodName } from "../utils/naming.js";

/**
 * Describes the existing generated client files and their parsed content
 */
export interface ExistingClient {
  methodNames: string[];
  typeNames: string[];
  customSections: CustomSection[];
  clientSource: string;
  typesSource: string;
}

/**
 * A preserved custom code block between @custom and @end-custom markers
 */
export interface CustomSection {
  marker: string;
  content: string;
}

/**
 * Result of comparing existing endpoints with newly-inferred ones
 */
export interface MergeResult {
  added: string[];
  updated: string[];
  deprecated: string[];
  summary: string;
  hasChanges: boolean;
}

/**
 * Checks whether outputDir already contains generated client files.
 * If both client.ts and types.ts exist, parses them and returns an ExistingClient.
 * @param outputDir - the directory to check for existing generated files
 * @returns the parsed existing client or null if files don't exist
 */
export async function detectExistingClient(
  outputDir: string
): Promise<ExistingClient | null> {
  const clientPath = join(outputDir, "client.ts");
  const typesPath = join(outputDir, "types.ts");

  try {
    await access(clientPath);
    await access(typesPath);
  } catch {
    return null;
  }

  const clientSource = await readFile(clientPath, "utf-8");
  const typesSource = await readFile(typesPath, "utf-8");

  const methodNames = parseMethodNames(clientSource);
  const typeNames = parseTypeNames(typesSource);
  const customSections = [
    ...parseCustomSections(clientSource),
    ...parseCustomSections(typesSource),
  ];

  return { methodNames, typeNames, customSections, clientSource, typesSource };
}

/**
 * Extracts async method names from client source using the `async methodName(` pattern
 * @param source - the client source code to parse
 * @returns array of method names found in the source
 */
function parseMethodNames(source: string): string[] {
  const re = /async\s+(\w+)\s*\(/g;
  return [...source.matchAll(re)].map(m => m[1]);
}

/**
 * Extracts exported interface names from types source
 * @param source - the types source code to parse
 * @returns array of interface names found in the source
 */
function parseTypeNames(source: string): string[] {
  const re = /export\s+interface\s+(\w+)/g;
  return [...source.matchAll(re)].map(m => m[1]);
}

/**
 * Parses @custom ... @end-custom blocks from source code
 * @param source - the source code to scan for custom sections
 * @returns array of custom sections with their markers and content
 */
function parseCustomSections(source: string): CustomSection[] {
  const re = /(\/\/\s*@custom\b[^\n]*)\n([\s\S]*?)(?=\/\/\s*@end-custom)/g;
  return [...source.matchAll(re)].map(match => ({
    marker: match[1].trim(),
    content: `${match[0]}// @end-custom`,
  }));
}

/**
 * Compares existing endpoints/types with newly inferred ones and returns a categorized MergeResult
 * @param existing - the existing client metadata
 * @param newEndpoints - the newly inferred API endpoints
 * @param _newTypes - the newly inferred types (reserved for future use)
 * @returns a merge result categorizing endpoints as added, updated, or deprecated
 */
export function mergeEndpoints(
  existing: ExistingClient,
  newEndpoints: Endpoint[],
  _newTypes: TypeDefinition[]
): MergeResult {
  const existingMethodSet = new Set(existing.methodNames);
  const newMethodMap = new Map(
    newEndpoints.map(ep => [pathToMethodName(ep.method, ep.normalizedPath), ep])
  );

  const added = [...newMethodMap.keys()].filter(
    name => !existingMethodSet.has(name)
  );
  const updated = [...newMethodMap.keys()].filter(name =>
    existingMethodSet.has(name)
  );
  const deprecated = existing.methodNames.filter(
    name => !newMethodMap.has(name)
  );

  const hasChanges =
    added.length > 0 || updated.length > 0 || deprecated.length > 0;

  const summary = buildSummary(added, updated, deprecated);

  return { added, updated, deprecated, summary, hasChanges };
}

/**
 * Builds a human-readable summary string from merge categories
 * @param added - newly added endpoint names
 * @param updated - updated endpoint names
 * @param deprecated - deprecated endpoint names
 * @returns a summary string describing the changes
 */
function buildSummary(
  added: string[],
  updated: string[],
  deprecated: string[]
): string {
  const parts = [
    ...(added.length > 0
      ? [`Added ${added.length} new endpoint${added.length === 1 ? "" : "s"}`]
      : []),
    ...(updated.length > 0
      ? [`updated ${updated.length} type${updated.length === 1 ? "" : "s"}`]
      : []),
    ...(deprecated.length > 0
      ? [
          `${deprecated.length} endpoint${deprecated.length === 1 ? "" : "s"} deprecated`,
        ]
      : []),
  ];

  return parts.length > 0 ? parts.join(", ") : "No changes detected";
}

/**
 * Writes the merged client and types files to outputDir, applying
 * deprecation markers and preserving custom sections
 * @param outputDir - the output directory for the generated files
 * @param mergeResult - the merge result with categorized changes
 * @param fullClientCode - the newly generated client source code
 * @param fullTypesCode - the newly generated types source code
 * @returns a human-readable summary string
 */
export async function applyMerge(
  outputDir: string,
  mergeResult: MergeResult,
  fullClientCode: string,
  fullTypesCode: string
): Promise<string> {
  const clientWithDeprecations = mergeResult.deprecated.reduce(
    (code, methodName) => addDeprecationMarker(code, methodName),
    fullClientCode
  );

  const existing = await detectExistingClient(outputDir);
  const sections = existing ? existing.customSections : [];

  const clientCode = sections.reduce(
    (code, section) => restoreCustomSection(code, section),
    clientWithDeprecations
  );
  const typesCode = sections.reduce(
    (code, section) => restoreCustomSection(code, section),
    fullTypesCode
  );

  await writeFile(join(outputDir, "client.ts"), clientCode, "utf-8");
  await writeFile(join(outputDir, "types.ts"), typesCode, "utf-8");

  return mergeResult.summary;
}

/**
 * Inserts a @deprecated JSDoc comment before a method declaration if not already present
 * @param source - the source code to modify
 * @param methodName - the method name to mark as deprecated
 * @returns the source code with the deprecation marker added
 */
function addDeprecationMarker(source: string, methodName: string): string {
  const deprecationComment =
    "/** @deprecated No longer observed in API traffic */";

  const methodPattern = new RegExp(
    `(^[ \\t]*)(async\\s+${escapeRegExp(methodName)}\\s*\\()`,
    "m"
  );

  const match = methodPattern.exec(source);
  if (!match) return source;

  const indent = match[1];
  const methodDecl = match[2];

  const before = source.slice(0, match.index);
  if (/\/\*\*[^]*?@deprecated[^]*?\*\/\s*$/.test(before)) {
    return source;
  }

  return source.replace(
    methodPattern,
    `${indent}${deprecationComment}\n${indent}${methodDecl}`
  );
}

/**
 * Restores a preserved custom section into the new source code
 * @param source - the new source code to inject the custom section into
 * @param section - the custom section to restore
 * @returns the source with the custom section restored
 */
function restoreCustomSection(source: string, section: CustomSection): string {
  const markerEscaped = escapeRegExp(section.marker);
  const blockRe = new RegExp(
    `${markerEscaped}[\\s\\S]*?//\\s*@end-custom`,
    "g"
  );

  if (blockRe.test(source)) {
    return source.replace(blockRe, section.content);
  }

  const lastBrace = source.lastIndexOf("}");
  if (lastBrace !== -1) {
    return `${source.slice(0, lastBrace)}\n${section.content}\n${source.slice(lastBrace)}`;
  }

  return `${source}\n${section.content}\n`;
}

/**
 * Escapes special regex characters in a string for safe use in RegExp
 * @param s - the string to escape
 * @returns the regex-safe escaped string
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
