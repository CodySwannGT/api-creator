import type { Endpoint } from "../types/endpoint.js";

import { pathToTypeName } from "../utils/naming.js";
import { mergeObjectShapes, mergeScalarTypes } from "./property-inferrer.js";

/**
 * Describes a generated TypeScript type with its properties and array status
 */
export interface TypeDefinition {
  name: string;
  properties: PropertyDefinition[];
  isArray: boolean;
}

/**
 * Describes a single property within a generated type
 */
export interface PropertyDefinition {
  name: string;
  type: string;
  optional: boolean;
  isArray: boolean;
  nestedType?: TypeDefinition;
}

/**
 * Infers response types from the observed response bodies of each endpoint
 * @param endpoints - the API endpoints with observed response data
 * @returns array of inferred type definitions
 */
export function inferTypes(endpoints: Endpoint[]): TypeDefinition[] {
  return endpoints.flatMap(endpoint => {
    const bodies = endpoint.responseBodies;
    if (bodies.length === 0) return [];

    const typeName = pathToTypeName(endpoint.method, endpoint.normalizedPath);
    const result = inferTypeFromBodies(bodies, typeName);
    return result ? [result.type, ...result.discoveredTypes] : [];
  });
}

/**
 * Infers request types from the observed request bodies of each endpoint
 * @param endpoints - the API endpoints with observed request data
 * @returns array of inferred request type definitions
 */
export function inferRequestTypes(endpoints: Endpoint[]): TypeDefinition[] {
  return endpoints.flatMap(endpoint => {
    const bodies = endpoint.requestBodies;
    if (bodies.length === 0) return [];

    const baseName = pathToTypeName(endpoint.method, endpoint.normalizedPath);
    const typeName = baseName.replace(/Response$/, "Request");
    const result = inferTypeFromBodies(bodies, typeName);
    return result ? [result.type, ...result.discoveredTypes] : [];
  });
}

/**
 * Result of inferring a type from bodies, including any discovered nested types
 */
interface TypeInferResult {
  type: TypeDefinition;
  discoveredTypes: TypeDefinition[];
}

/**
 * Infers a TypeDefinition from multiple observed bodies.
 * Returns null if none of the bodies are valid JSON objects/arrays.
 * @param bodies - the raw response/request bodies to infer from
 * @param typeName - the name to assign to the inferred type
 * @returns the inferred type and discovered nested types, or null
 */
function inferTypeFromBodies(
  bodies: unknown[],
  typeName: string
): TypeInferResult | null {
  const parsed = parseBodies(bodies);
  if (parsed.length === 0) return null;

  const arrayObservations = parsed.filter(Array.isArray);
  const objectObservations = parsed.filter(
    (v): v is Record<string, unknown> =>
      v !== null && typeof v === "object" && !Array.isArray(v)
  );

  if (arrayObservations.length > 0 && objectObservations.length === 0) {
    return inferArrayType(arrayObservations, typeName);
  }

  if (objectObservations.length > 0) {
    const { properties, discoveredTypes } = mergeObjectShapes(
      objectObservations,
      typeName
    );
    return {
      type: { name: typeName, properties, isArray: false },
      discoveredTypes,
    };
  }

  return null;
}

/**
 * Infers a TypeDefinition from array observations
 * @param arrayObservations - the observed array values
 * @param typeName - the type name to use
 * @returns the inferred TypeDefinition with any nested types
 */
function inferArrayType(
  arrayObservations: unknown[],
  typeName: string
): TypeInferResult {
  const elements = arrayObservations.flatMap(arr => arr as unknown[]);

  if (elements.length === 0) {
    return {
      type: { name: typeName, properties: [], isArray: true },
      discoveredTypes: [],
    };
  }

  if (elements.every(e => e === null || typeof e !== "object")) {
    mergeScalarTypes(elements);
    return {
      type: { name: typeName, properties: [], isArray: true },
      discoveredTypes: [],
    };
  }

  const objectElements = elements.filter(
    (e): e is Record<string, unknown> =>
      e !== null && typeof e === "object" && !Array.isArray(e)
  );

  if (objectElements.length === 0) {
    return {
      type: { name: typeName, properties: [], isArray: true },
      discoveredTypes: [],
    };
  }

  const { properties, discoveredTypes } = mergeObjectShapes(
    objectElements,
    typeName
  );
  return {
    type: { name: typeName, properties, isArray: true },
    discoveredTypes,
  };
}

/**
 * Parses bodies, filtering out non-JSON content and parsing JSON strings
 * @param bodies - the raw bodies to parse
 * @returns array of parsed values (objects, arrays, primitives)
 */
function parseBodies(bodies: unknown[]): unknown[] {
  return bodies.flatMap(body => {
    if (body === undefined || body === null) return [];
    if (typeof body === "string") {
      const trimmed = body.trim();
      if (trimmed === "") return [];
      try {
        return [JSON.parse(trimmed)];
      } catch {
        return [];
      }
    }
    return [body];
  });
}
