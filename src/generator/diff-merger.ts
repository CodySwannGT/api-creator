import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Endpoint } from '../types/endpoint.js';
import type { TypeDefinition } from '../parser/type-inferrer.js';
import { pathToMethodName } from '../utils/naming.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ExistingClient {
  methodNames: string[];
  typeNames: string[];
  customSections: CustomSection[];
  clientSource: string;
  typesSource: string;
}

export interface CustomSection {
  marker: string;
  content: string;
}

export interface MergeResult {
  added: string[];
  updated: string[];
  deprecated: string[];
  summary: string;
  hasChanges: boolean;
}

// ---------------------------------------------------------------------------
// detectExistingClient
// ---------------------------------------------------------------------------

/**
 * Check whether `outputDir` already contains generated client files.
 * If both `client.ts` and `types.ts` exist, parse them and return an
 * {@link ExistingClient} describing what is already generated.  Otherwise
 * return `null`.
 */
export async function detectExistingClient(
  outputDir: string,
): Promise<ExistingClient | null> {
  const clientPath = join(outputDir, 'client.ts');
  const typesPath = join(outputDir, 'types.ts');

  try {
    await access(clientPath);
    await access(typesPath);
  } catch {
    return null;
  }

  const clientSource = await readFile(clientPath, 'utf-8');
  const typesSource = await readFile(typesPath, 'utf-8');

  const methodNames = parseMethodNames(clientSource);
  const typeNames = parseTypeNames(typesSource);
  const customSections = parseCustomSections(clientSource).concat(
    parseCustomSections(typesSource),
  );

  return { methodNames, typeNames, customSections, clientSource, typesSource };
}

/**
 * Extract async method names from client source using the pattern
 * `async methodName(`.
 */
function parseMethodNames(source: string): string[] {
  const re = /async\s+(\w+)\s*\(/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Extract exported interface / type names from types source using the
 * pattern `export interface TypeName`.
 */
function parseTypeNames(source: string): string[] {
  const re = /export\s+interface\s+(\w+)/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Parse `// @custom` … `// @end-custom` blocks.  Each block is returned as a
 * {@link CustomSection} with the marker line and the content between the two
 * comment lines (inclusive).
 */
function parseCustomSections(source: string): CustomSection[] {
  const sections: CustomSection[] = [];
  const re = /(\/\/\s*@custom\b[^\n]*)\n([\s\S]*?)(?=\/\/\s*@end-custom)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const marker = match[1].trim();
    const content = match[0] + '// @end-custom';
    sections.push({ marker, content });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// mergeEndpoints
// ---------------------------------------------------------------------------

/**
 * Compare the endpoints / types that already exist with the newly inferred
 * ones and return a categorised {@link MergeResult}.
 */
export function mergeEndpoints(
  existing: ExistingClient,
  newEndpoints: Endpoint[],
  newTypes: TypeDefinition[],
): MergeResult {
  const existingMethodSet = new Set(existing.methodNames);

  const newMethodMap = new Map<string, Endpoint>();
  for (const ep of newEndpoints) {
    const name = pathToMethodName(ep.method, ep.normalizedPath);
    newMethodMap.set(name, ep);
  }

  const added: string[] = [];
  const updated: string[] = [];
  const deprecated: string[] = [];

  // Categorise each new endpoint method name.
  for (const name of newMethodMap.keys()) {
    if (existingMethodSet.has(name)) {
      updated.push(name);
    } else {
      added.push(name);
    }
  }

  // Existing methods that no longer appear in the new set are deprecated.
  for (const name of existing.methodNames) {
    if (!newMethodMap.has(name)) {
      deprecated.push(name);
    }
  }

  const hasChanges =
    added.length > 0 || updated.length > 0 || deprecated.length > 0;

  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`Added ${added.length} new endpoint${added.length === 1 ? '' : 's'}`);
  }
  if (updated.length > 0) {
    parts.push(`updated ${updated.length} type${updated.length === 1 ? '' : 's'}`);
  }
  if (deprecated.length > 0) {
    parts.push(`${deprecated.length} endpoint${deprecated.length === 1 ? '' : 's'} deprecated`);
  }

  const summary = parts.length > 0 ? parts.join(', ') : 'No changes detected';

  return { added, updated, deprecated, summary, hasChanges };
}

// ---------------------------------------------------------------------------
// applyMerge
// ---------------------------------------------------------------------------

/**
 * Write the merged client and types files to `outputDir`, applying
 * deprecation markers and preserving custom sections.  Returns a
 * human-readable summary string.
 */
export async function applyMerge(
  outputDir: string,
  mergeResult: MergeResult,
  fullClientCode: string,
  fullTypesCode: string,
): Promise<string> {
  let clientCode = fullClientCode;
  let typesCode = fullTypesCode;

  // 1. Mark deprecated methods with a @deprecated JSDoc comment.
  for (const methodName of mergeResult.deprecated) {
    clientCode = addDeprecationMarker(clientCode, methodName);
  }

  // 2. Restore custom sections from the existing code.
  //    We look for the matching @custom marker in the new code and replace /
  //    inject the preserved block.
  const existing = await detectExistingClient(outputDir);
  if (existing) {
    for (const section of existing.customSections) {
      clientCode = restoreCustomSection(clientCode, section);
      typesCode = restoreCustomSection(typesCode, section);
    }
  }

  // 3. Write files.
  await writeFile(join(outputDir, 'client.ts'), clientCode, 'utf-8');
  await writeFile(join(outputDir, 'types.ts'), typesCode, 'utf-8');

  return mergeResult.summary;
}

/**
 * Insert a `/** @deprecated … *​/` JSDoc comment before an `async methodName(`
 * declaration if one is not already present.
 */
function addDeprecationMarker(source: string, methodName: string): string {
  const deprecationComment =
    '/** @deprecated No longer observed in API traffic */';

  // Build a regex that matches the method, optionally preceded by existing JSDoc.
  const methodPattern = new RegExp(
    `(^[ \\t]*)(async\\s+${escapeRegExp(methodName)}\\s*\\()`,
    'm',
  );

  const match = methodPattern.exec(source);
  if (!match) return source;

  const indent = match[1];
  const methodDecl = match[2];

  // Check if there is already a @deprecated tag right before this line.
  const before = source.slice(0, match.index);
  if (/\/\*\*[^]*?@deprecated[^]*?\*\/\s*$/.test(before)) {
    return source; // already marked
  }

  return source.replace(
    methodPattern,
    `${indent}${deprecationComment}\n${indent}${methodDecl}`,
  );
}

/**
 * If the new source contains the same `// @custom <marker>` line, replace the
 * generated block between `@custom` and `@end-custom` with the preserved
 * content.  If the marker is not present, append the custom section at the end
 * of the file (before the final closing brace if one exists).
 */
function restoreCustomSection(source: string, section: CustomSection): string {
  // Try to find an existing @custom…@end-custom block with the same marker.
  const markerEscaped = escapeRegExp(section.marker);
  const blockRe = new RegExp(
    `${markerEscaped}[\\s\\S]*?//\\s*@end-custom`,
    'g',
  );

  if (blockRe.test(source)) {
    return source.replace(blockRe, section.content);
  }

  // The marker doesn't exist in the new source – append before the last `}`.
  const lastBrace = source.lastIndexOf('}');
  if (lastBrace !== -1) {
    return (
      source.slice(0, lastBrace) +
      '\n' +
      section.content +
      '\n' +
      source.slice(lastBrace)
    );
  }

  // Fallback – just append.
  return source + '\n' + section.content + '\n';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
