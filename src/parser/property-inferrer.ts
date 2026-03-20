import type { TypeDefinition, PropertyDefinition } from "./type-inferrer.js";

/**
 * Result of inferring properties, including any discovered nested types
 */
export interface InferResult {
  properties: PropertyDefinition[];
  discoveredTypes: TypeDefinition[];
}

/**
 * Result of inferring a single property, including any discovered nested types
 */
export interface PropertyInferResult {
  property: PropertyDefinition;
  discoveredTypes: TypeDefinition[];
}

/**
 * Capitalizes the first letter of a string
 * @param s - the string to capitalize
 * @returns the string with its first character uppercased
 */
function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Strips Response/Request suffix from a type name for nested naming
 * @param name - the type name to strip suffixes from
 * @returns the base name without Response/Request suffix
 */
function stripSuffix(name: string): string {
  if (name.endsWith("Response")) return name.slice(0, -"Response".length);
  if (name.endsWith("Request")) return name.slice(0, -"Request".length);
  return name;
}

/**
 * Merges types of scalar values into a union string
 * @param values - the scalar values to merge
 * @returns a union type string like "string | number"
 */
export function mergeScalarTypes(values: unknown[]): string {
  const types = new Set(values.map(v => (v === null ? "null" : typeof v)));
  return [...types].sort((a, b) => a.localeCompare(b)).join(" | ") || "unknown";
}

/**
 * Merges multiple observations of the same object shape into PropertyDefinitions.
 * Properties that don't appear in every observation are marked optional.
 * @param observations - the observed object instances
 * @param parentTypeName - the parent type name for nested type naming
 * @returns the merged property definitions and any discovered nested types
 */
export function mergeObjectShapes(
  observations: Record<string, unknown>[],
  parentTypeName: string
): InferResult {
  if (observations.length === 0) {
    return { properties: [], discoveredTypes: [] };
  }

  const allKeys = new Set(observations.flatMap(obj => Object.keys(obj)));
  const totalCount = observations.length;

  const results = [...allKeys].map(key => {
    const values = observations.flatMap(obj => (key in obj ? [obj[key]] : []));
    const presentCount = observations.filter(obj => key in obj).length;
    const isOptional = presentCount < totalCount;

    return inferPropertyDefinition(key, values, isOptional, parentTypeName);
  });

  const properties = results
    .map(r => r.property)
    .sort((a, b) => a.name.localeCompare(b.name));
  const discoveredTypes = results.flatMap(r => r.discoveredTypes);

  return { properties, discoveredTypes };
}

/**
 * Infers a nested object property definition, creating a new nested type
 * @param name - the property name
 * @param objectValues - the observed object values for this property
 * @param hasNull - whether null was observed among values
 * @param isOptional - whether the property is optional based on observation frequency
 * @param parentTypeName - the parent type name for generating nested type names
 * @returns the inferred property definition with nested type reference and discovered types
 */
function inferNestedObjectProperty(
  name: string,
  objectValues: Record<string, unknown>[],
  hasNull: boolean,
  isOptional: boolean,
  parentTypeName: string
): PropertyInferResult {
  const nestedName = stripSuffix(parentTypeName) + capitalize(name);
  const { properties: nestedProperties, discoveredTypes: childTypes } =
    mergeObjectShapes(objectValues, nestedName);

  const nestedType: TypeDefinition = {
    name: nestedName,
    properties: nestedProperties,
    isArray: false,
  };

  const type = hasNull ? `${nestedName} | null` : nestedName;
  const optional = hasNull ? true : isOptional;

  return {
    property: { name, type, optional, isArray: false, nestedType },
    discoveredTypes: [...childTypes, nestedType],
  };
}

/**
 * Categorizes non-null values into objects, arrays, and scalar types
 * @param nonNullValues - the non-null values to categorize
 * @returns categorized values with their types
 */
function categorizeValues(nonNullValues: unknown[]): {
  objectValues: Record<string, unknown>[];
  arrayValues: unknown[][];
  scalarTypes: Set<string>;
} {
  const objectValues = nonNullValues.filter(
    (v): v is Record<string, unknown> =>
      typeof v === "object" && !Array.isArray(v)
  );
  const arrayValues = nonNullValues.filter((v): v is unknown[] =>
    Array.isArray(v)
  );
  const scalarTypes = new Set(
    nonNullValues
      .filter(v => typeof v !== "object" && !Array.isArray(v))
      .map(v => typeof v)
  );
  return { objectValues, arrayValues, scalarTypes };
}

/**
 * Builds a scalar-only property definition from observed types
 * @param name - the property name
 * @param scalarTypes - the set of observed scalar types
 * @param hasNull - whether null was observed
 * @param isOptional - whether the property is optional
 * @returns the scalar property result with no discovered types
 */
function buildScalarProperty(
  name: string,
  scalarTypes: Set<string>,
  hasNull: boolean,
  isOptional: boolean
): PropertyInferResult {
  const baseType = [...scalarTypes]
    .sort((a, b) => a.localeCompare(b))
    .join(" | ");
  const type = hasNull ? `${baseType} | null` : baseType;
  const optional = hasNull ? true : isOptional;
  return {
    property: { name, type, optional, isArray: false },
    discoveredTypes: [],
  };
}

/**
 * Builds a mixed-type property definition when values span multiple categories
 * @param name - the property name
 * @param hasScalars - whether scalar values were observed
 * @param hasObjects - whether object values were observed
 * @param hasArrays - whether array values were observed
 * @param hasNull - whether null was observed
 * @param scalarTypes - the set of observed scalar types
 * @param isOptional - whether the property is optional
 * @returns the mixed-type property result with no discovered types
 */
function buildMixedProperty(
  name: string,
  hasScalars: boolean,
  hasObjects: boolean,
  hasArrays: boolean,
  hasNull: boolean,
  scalarTypes: Set<string>,
  isOptional: boolean
): PropertyInferResult {
  const typeParts = [
    ...(hasScalars ? [...scalarTypes].sort((a, b) => a.localeCompare(b)) : []),
    ...(hasObjects ? ["object"] : []),
    ...(hasArrays ? ["unknown[]"] : []),
    ...(hasNull ? ["null"] : []),
  ];
  const optional = hasNull ? true : isOptional;
  return {
    property: { name, type: typeParts.join(" | "), optional, isArray: false },
    discoveredTypes: [],
  };
}

/**
 * Infers a single PropertyDefinition from the observed values of a property.
 * Dispatches to specialized helpers based on value categories.
 * @param name - the property name
 * @param values - the observed values across all observations
 * @param isOptional - whether the property is optional based on observation frequency
 * @param parentTypeName - the parent type name for nested type naming
 * @returns the inferred property definition and any discovered nested types
 */
export function inferPropertyDefinition(
  name: string,
  values: unknown[],
  isOptional: boolean,
  parentTypeName: string
): PropertyInferResult {
  const hasNull = values.some(v => v === null);
  const nonNullValues = values.filter(v => v !== null);

  if (nonNullValues.length === 0) {
    return {
      property: { name, type: "null", optional: true, isArray: false },
      discoveredTypes: [],
    };
  }

  const { objectValues, arrayValues, scalarTypes } =
    categorizeValues(nonNullValues);

  const hasObjects = objectValues.length > 0;
  const hasArrays = arrayValues.length > 0;
  const hasScalars = scalarTypes.size > 0;

  if (!hasObjects && !hasArrays) {
    return buildScalarProperty(name, scalarTypes, hasNull, isOptional);
  }

  if (hasObjects && !hasArrays && !hasScalars) {
    return inferNestedObjectProperty(
      name,
      objectValues,
      hasNull,
      isOptional,
      parentTypeName
    );
  }

  if (hasArrays && !hasObjects && !hasScalars) {
    return inferArrayProperty(
      name,
      arrayValues,
      isOptional,
      hasNull,
      parentTypeName
    );
  }

  return buildMixedProperty(
    name,
    hasScalars,
    hasObjects,
    hasArrays,
    hasNull,
    scalarTypes,
    isOptional
  );
}

/**
 * Categorizes array elements into objects, scalars, nulls, and nested arrays
 * @param allElements - all elements from all observed arrays
 * @returns categorized element information
 */
function categorizeElements(allElements: unknown[]): {
  objectElements: Record<string, unknown>[];
  elementScalarTypes: Set<string>;
  hasNullElements: boolean;
  hasArrayElements: boolean;
} {
  return {
    objectElements: allElements.filter(
      (el): el is Record<string, unknown> =>
        el !== null && typeof el === "object" && !Array.isArray(el)
    ),
    elementScalarTypes: new Set(
      allElements
        .filter(
          el => el !== null && typeof el !== "object" && !Array.isArray(el)
        )
        .map(el => typeof el)
    ),
    hasNullElements: allElements.some(el => el === null),
    hasArrayElements: allElements.some(el => Array.isArray(el)),
  };
}

/**
 * Infers a PropertyDefinition for a property that is always an array.
 * Dispatches to specialized helpers based on element categories.
 * @param name - the property name
 * @param arrayValues - the observed array values
 * @param isOptional - whether the property is optional
 * @param hasNull - whether null values were observed at the property level
 * @param parentTypeName - the parent type name for nested type naming
 * @returns the inferred property definition for the array and any discovered types
 */
export function inferArrayProperty(
  name: string,
  arrayValues: unknown[][],
  isOptional: boolean,
  hasNull: boolean,
  parentTypeName: string
): PropertyInferResult {
  const allElements = arrayValues.flat();
  const optional = hasNull ? true : isOptional;

  if (allElements.length === 0) {
    return {
      property: { name, type: "unknown", optional, isArray: true },
      discoveredTypes: [],
    };
  }

  const {
    objectElements,
    elementScalarTypes,
    hasNullElements,
    hasArrayElements,
  } = categorizeElements(allElements);

  if (
    objectElements.length > 0 &&
    elementScalarTypes.size === 0 &&
    !hasArrayElements
  ) {
    return inferArrayObjectElements(
      name,
      objectElements,
      hasNull,
      isOptional,
      parentTypeName
    );
  }

  if (objectElements.length === 0 && !hasArrayElements) {
    const parts = [
      ...[...elementScalarTypes].sort((a, b) => a.localeCompare(b)),
      ...(hasNullElements ? ["null"] : []),
    ];
    const type = parts.join(" | ") || "unknown";
    return {
      property: { name, type, optional, isArray: true },
      discoveredTypes: [],
    };
  }

  return {
    property: { name, type: "unknown", optional, isArray: true },
    discoveredTypes: [],
  };
}

/**
 * Infers array property when all elements are objects, creating a nested Item type
 * @param name - the property name
 * @param objectElements - the object elements from the array
 * @param hasNull - whether null was observed at the property level
 * @param isOptional - whether the property is optional
 * @param parentTypeName - the parent type name for nested type naming
 * @returns the array property definition with nested item type and discovered types
 */
function inferArrayObjectElements(
  name: string,
  objectElements: Record<string, unknown>[],
  hasNull: boolean,
  isOptional: boolean,
  parentTypeName: string
): PropertyInferResult {
  const nestedName = `${stripSuffix(parentTypeName) + capitalize(name)}Item`;
  const { properties: nestedProperties, discoveredTypes: childTypes } =
    mergeObjectShapes(objectElements, nestedName);

  const nestedType: TypeDefinition = {
    name: nestedName,
    properties: nestedProperties,
    isArray: false,
  };

  const type = hasNull ? `${nestedName} | null` : nestedName;
  const optional = hasNull ? true : isOptional;

  return {
    property: { name, type, optional, isArray: true, nestedType },
    discoveredTypes: [...childTypes, nestedType],
  };
}
