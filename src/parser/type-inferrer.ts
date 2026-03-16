import type { Endpoint } from '../types/endpoint.js';
import { pathToTypeName } from '../utils/naming.js';

export interface TypeDefinition {
  name: string;
  properties: PropertyDefinition[];
  isArray: boolean;
}

export interface PropertyDefinition {
  name: string;
  type: string; // 'string' | 'number' | 'boolean' | 'null' | TypeDefinition name | 'unknown'
  optional: boolean;
  isArray: boolean;
  nestedType?: TypeDefinition;
}

/**
 * Infer response types from the observed response bodies of each endpoint.
 */
export function inferTypes(endpoints: Endpoint[]): TypeDefinition[] {
  const types: TypeDefinition[] = [];

  for (const endpoint of endpoints) {
    const bodies = endpoint.responseBodies;
    if (bodies.length === 0) continue;

    const baseName = pathToTypeName(endpoint.method, endpoint.normalizedPath);
    // pathToTypeName already appends "Response", so use the name directly.
    const typeName = baseName;

    const result = inferTypeFromBodies(bodies, typeName, types);
    if (result) {
      types.push(result);
    }
  }

  return types;
}

/**
 * Infer request types from the observed request bodies of each endpoint.
 */
export function inferRequestTypes(endpoints: Endpoint[]): TypeDefinition[] {
  const types: TypeDefinition[] = [];

  for (const endpoint of endpoints) {
    const bodies = endpoint.requestBodies;
    if (bodies.length === 0) continue;

    const baseName = pathToTypeName(endpoint.method, endpoint.normalizedPath);
    // Replace trailing "Response" with "Request"
    const typeName = baseName.replace(/Response$/, 'Request');

    const result = inferTypeFromBodies(bodies, typeName, types);
    if (result) {
      types.push(result);
    }
  }

  return types;
}

/**
 * Infer a TypeDefinition from multiple observed bodies, collecting nested types into
 * the provided `collector` array.
 *
 * Returns null if none of the bodies are valid JSON objects/arrays.
 */
function inferTypeFromBodies(
  bodies: unknown[],
  typeName: string,
  collector: TypeDefinition[],
): TypeDefinition | null {
  // Filter to only JSON-compatible values (objects, arrays, primitives that parsed from JSON).
  // Skip strings that look like non-JSON content and skip undefined/empty values.
  const parsed = parseBodies(bodies);
  if (parsed.length === 0) return null;

  // Determine if the response is an array type.
  // If any observation is an array, we treat the type as an array type and unwrap elements.
  const arrayObservations = parsed.filter(Array.isArray);
  const objectObservations = parsed.filter(
    (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  );

  if (arrayObservations.length > 0 && objectObservations.length === 0) {
    // All observations are arrays – unwrap and merge element types
    const elements: unknown[] = [];
    for (const arr of arrayObservations) {
      elements.push(...(arr as unknown[]));
    }

    if (elements.length === 0) {
      return { name: typeName, properties: [], isArray: true };
    }

    // Check if elements are all primitives
    if (elements.every((e) => e === null || typeof e !== 'object')) {
      const mergedType = mergeScalarTypes(elements);
      return {
        name: typeName,
        properties: [],
        isArray: true,
        // Encode primitive array in a lightweight way – no properties, just the name
        // The consumer can check isArray + properties.length === 0 to know it's a primitive array.
      } satisfies TypeDefinition;
    }

    // Check for mixed array (some primitives, some objects)
    const objectElements = elements.filter(
      (e) => e !== null && typeof e === 'object' && !Array.isArray(e),
    );
    if (objectElements.length === 0) {
      // Arrays of arrays or mixed weirdness – mark as unknown
      return { name: typeName, properties: [], isArray: true };
    }

    // Merge object elements
    const properties = mergeObjectShapes(
      objectElements as Record<string, unknown>[],
      typeName,
      collector,
    );
    return { name: typeName, properties, isArray: true };
  }

  if (objectObservations.length > 0) {
    // Merge all object observations (ignore array observations – mixed shape)
    const properties = mergeObjectShapes(
      objectObservations as Record<string, unknown>[],
      typeName,
      collector,
    );
    return { name: typeName, properties, isArray: false };
  }

  // All observations are primitives – not meaningful as a TypeDefinition
  return null;
}

/**
 * Parse bodies, filtering out non-JSON content.
 */
function parseBodies(bodies: unknown[]): unknown[] {
  const results: unknown[] = [];
  for (const body of bodies) {
    if (body === undefined || body === null) continue;
    if (typeof body === 'string') {
      // Try to parse as JSON
      const trimmed = body.trim();
      if (trimmed === '') continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        // Non-JSON string – skip
        continue;
      }
    } else {
      // Already parsed (object, array, number, boolean)
      results.push(body);
    }
  }
  return results;
}

/**
 * Merge multiple observations of the same object shape into a list of PropertyDefinitions.
 * Properties that don't appear in every observation are marked optional.
 */
function mergeObjectShapes(
  observations: Record<string, unknown>[],
  parentTypeName: string,
  collector: TypeDefinition[],
): PropertyDefinition[] {
  if (observations.length === 0) return [];

  // Gather all property names and their per-observation values
  const allKeys = new Set<string>();
  for (const obj of observations) {
    for (const key of Object.keys(obj)) {
      allKeys.add(key);
    }
  }

  const totalCount = observations.length;
  const properties: PropertyDefinition[] = [];

  for (const key of allKeys) {
    // Collect the values for this key across all observations
    const values: unknown[] = [];
    let presentCount = 0;

    for (const obj of observations) {
      if (key in obj) {
        presentCount++;
        values.push(obj[key]);
      }
    }

    const optional = presentCount < totalCount;
    const prop = inferPropertyDefinition(key, values, optional, parentTypeName, collector);
    properties.push(prop);
  }

  // Sort properties alphabetically for deterministic output
  properties.sort((a, b) => a.name.localeCompare(b.name));
  return properties;
}

/**
 * Infer a single PropertyDefinition from the observed values of a property.
 */
function inferPropertyDefinition(
  name: string,
  values: unknown[],
  optional: boolean,
  parentTypeName: string,
  collector: TypeDefinition[],
): PropertyDefinition {
  // Separate nulls from non-null values
  const hasNull = values.some((v) => v === null);
  const nonNullValues = values.filter((v) => v !== null);

  // If all values are null, type is 'null' and optional
  if (nonNullValues.length === 0) {
    return { name, type: 'null', optional: true, isArray: false };
  }

  // Categorize non-null values
  const objectValues: Record<string, unknown>[] = [];
  const arrayValues: unknown[][] = [];
  const scalarTypes = new Set<string>();

  for (const v of nonNullValues) {
    if (Array.isArray(v)) {
      arrayValues.push(v);
    } else if (typeof v === 'object') {
      objectValues.push(v as Record<string, unknown>);
    } else {
      scalarTypes.add(typeof v); // 'string' | 'number' | 'boolean'
    }
  }

  const hasObjects = objectValues.length > 0;
  const hasArrays = arrayValues.length > 0;
  const hasScalars = scalarTypes.size > 0;

  // Simple case: all scalars, no objects, no arrays
  if (!hasObjects && !hasArrays) {
    let type = [...scalarTypes].sort().join(' | ');
    if (hasNull) {
      type = type + ' | null';
      optional = true;
    }
    return { name, type, optional, isArray: false };
  }

  // All values are objects (nested object)
  if (hasObjects && !hasArrays && !hasScalars) {
    const nestedTypeName = parentTypeName.replace(/Response$/, '').replace(/Request$/, '') +
      capitalize(name) +
      (parentTypeName.endsWith('Request') ? 'Request' : 'Response');
    // Actually, use a simpler naming: ParentPropertyName
    const nestedName = stripSuffix(parentTypeName) + capitalize(name);
    const nestedProperties = mergeObjectShapes(objectValues, nestedName, collector);
    const nestedType: TypeDefinition = {
      name: nestedName,
      properties: nestedProperties,
      isArray: false,
    };
    collector.push(nestedType);

    let type = nestedName;
    if (hasNull) {
      type = type + ' | null';
      optional = true;
    }
    return { name, type, optional, isArray: false, nestedType };
  }

  // All values are arrays
  if (hasArrays && !hasObjects && !hasScalars) {
    return inferArrayProperty(name, arrayValues, optional, hasNull, parentTypeName, collector);
  }

  // Mixed types – use union
  const typeParts: string[] = [];
  if (hasScalars) typeParts.push(...[...scalarTypes].sort());
  if (hasObjects) typeParts.push('object');
  if (hasArrays) typeParts.push('unknown[]');
  if (hasNull) {
    typeParts.push('null');
    optional = true;
  }
  return { name, type: typeParts.join(' | '), optional, isArray: false };
}

/**
 * Infer a PropertyDefinition for a property that is always an array.
 */
function inferArrayProperty(
  name: string,
  arrayValues: unknown[][],
  optional: boolean,
  hasNull: boolean,
  parentTypeName: string,
  collector: TypeDefinition[],
): PropertyDefinition {
  // Flatten all array elements
  const allElements: unknown[] = [];
  for (const arr of arrayValues) {
    allElements.push(...arr);
  }

  if (allElements.length === 0) {
    let type = 'unknown';
    if (hasNull) {
      optional = true;
    }
    return { name, type, optional, isArray: true };
  }

  // Categorize elements
  const objectElements: Record<string, unknown>[] = [];
  const elementScalarTypes = new Set<string>();
  let hasNullElements = false;
  let hasArrayElements = false;

  for (const el of allElements) {
    if (el === null) {
      hasNullElements = true;
    } else if (Array.isArray(el)) {
      hasArrayElements = true;
    } else if (typeof el === 'object') {
      objectElements.push(el as Record<string, unknown>);
    } else {
      elementScalarTypes.add(typeof el);
    }
  }

  // All elements are objects – create nested type
  if (objectElements.length > 0 && elementScalarTypes.size === 0 && !hasArrayElements) {
    const nestedName = stripSuffix(parentTypeName) + capitalize(name) + 'Item';
    const nestedProperties = mergeObjectShapes(objectElements, nestedName, collector);
    const nestedType: TypeDefinition = {
      name: nestedName,
      properties: nestedProperties,
      isArray: false,
    };
    collector.push(nestedType);

    let type = nestedName;
    if (hasNull) {
      type = type + ' | null';
      optional = true;
    }
    return { name, type, optional, isArray: true, nestedType };
  }

  // All elements are primitives
  if (objectElements.length === 0 && !hasArrayElements) {
    const parts = [...elementScalarTypes].sort();
    if (hasNullElements) parts.push('null');
    let type = parts.join(' | ') || 'unknown';
    if (hasNull) {
      optional = true;
    }
    return { name, type, optional, isArray: true };
  }

  // Mixed array elements – use unknown
  let type = 'unknown';
  if (hasNull) {
    optional = true;
  }
  return { name, type, optional, isArray: true };
}

/**
 * Merge types of scalar values into a union string.
 */
function mergeScalarTypes(values: unknown[]): string {
  const types = new Set<string>();
  for (const v of values) {
    if (v === null) {
      types.add('null');
    } else {
      types.add(typeof v);
    }
  }
  return [...types].sort().join(' | ') || 'unknown';
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Strip "Response" or "Request" suffix from a type name.
 */
function stripSuffix(name: string): string {
  if (name.endsWith('Response')) return name.slice(0, -'Response'.length);
  if (name.endsWith('Request')) return name.slice(0, -'Request'.length);
  return name;
}
