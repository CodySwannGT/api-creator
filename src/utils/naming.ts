/** Matches a long hex hash (40+ hex characters) — e.g. GraphQL persisted query hashes. */
const LONG_HEX_HASH_RE = /^[0-9a-f]{40,}$/i;

/** Common file extensions to strip from path segments. */
const FILE_EXT_RE = /\.(json|js|mjs|html|htm|css|xml|txt|yaml|yml)$/i;

/**
 * Maps an HTTP method to a verb used for method/type naming
 * @param method - the HTTP method (GET, POST, PUT, etc.)
 * @returns a lowercase verb string for use in generated names
 */
function verbForMethod(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "get";
    case "POST":
      return "create";
    case "PUT":
    case "PATCH":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return method.toLowerCase();
  }
}

/**
 * Cleans a single path segment by stripping extensions, hashes, and invalid chars,
 * then splitting on camelCase boundaries so "getListOfListings" becomes ["get", "List", "Of", "Listings"].
 * @param seg - the raw path segment to clean
 * @returns array of clean, valid identifier words from this segment
 */
export function cleanSegment(seg: string): string[] {
  if (LONG_HEX_HASH_RE.test(seg)) return [];

  const stripped = seg.replace(FILE_EXT_RE, "").replace(/\./g, "-");
  const parts = stripped.split(/[-_]+/).filter(p => p !== "");

  return parts.flatMap(part => {
    const clean = part.replace(/[^a-zA-Z0-9]/g, "");
    if (clean === "") return [];
    const noLeadingDigits = clean.replace(/^\d+/, "");
    if (noLeadingDigits === "") return [];
    return noLeadingDigits.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  });
}

/**
 * Splits a path into meaningful word segments for use in naming
 * @param path - the normalized API path with potential :id placeholders
 * @returns an object with the extracted words and whether :id was present
 */
function pathSegments(path: string): { words: string[]; hasId: boolean } {
  const segments = path.split("/").filter(s => s !== "");
  const hasId = segments.includes(":id");
  const words = segments.filter(seg => seg !== ":id").flatMap(cleanSegment);

  return { words, hasId };
}

/**
 * Capitalizes the first letter of a string, lowercasing the rest
 * @param s - the string to capitalize
 * @returns the capitalized string
 */
function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Converts an HTTP method + path to a camelCase method name
 *
 * Examples:
 *   GET /users/:id     → getUserById
 *   POST /users        → createUser
 *   PUT /users/:id     → updateUser
 *   DELETE /users/:id  → deleteUser
 *   GET /users         → getUsers
 *   GET /users/:id/posts/:id → getUserPostById
 * @param method - the HTTP method (GET, POST, PUT, etc.)
 * @param path - the normalized API path
 * @returns a camelCase method name like "getUsers" or "createUser"
 */
export function pathToMethodName(method: string, path: string): string {
  const verb = verbForMethod(method);
  const { words, hasId } = pathSegments(path);

  if (words.length === 0) {
    return verb + (hasId ? "ById" : "");
  }

  const camel = words.map(w => capitalize(w)).join("");
  const suffix = hasId ? "ById" : "";

  return verb + camel + suffix;
}

/**
 * Converts an HTTP method + path to a PascalCase type name
 *
 * Examples:
 *   GET /users         → GetUsersResponse
 *   POST /users        → CreateUserRequest / CreateUserResponse
 *   GET /users/:id     → GetUserByIdResponse
 * @param method - the HTTP method (GET, POST, PUT, etc.)
 * @param path - the normalized API path
 * @returns a PascalCase type name like "GetUsersResponse"
 */
export function pathToTypeName(method: string, path: string): string {
  const verb = verbForMethod(method);
  const { words, hasId } = pathSegments(path);

  const pascal =
    capitalize(verb) +
    words.map(w => capitalize(w)).join("") +
    (hasId ? "ById" : "");

  return `${pascal}Response`;
}

/**
 * Strips verb, api/version prefixes from camelCase segments for CLI command naming
 * @param parts - the kebab-case segments after splitting
 * @param verb - the HTTP verb to strip from the front
 * @returns filtered segments without verb, api, or version prefixes
 */
function stripPrefixes(parts: readonly string[], verb: string): string[] {
  const withoutVerb =
    parts.length > 0 && parts[0] === verb ? parts.slice(1) : [...parts];
  return withoutVerb.filter(p => p !== "api" && !/^v\d+$/.test(p));
}

/**
 * Removes "by-id" suffix and deduplicates consecutive identical segments
 * @param segments - the filtered CLI command segments
 * @returns cleaned segments without "by-id" and no consecutive duplicates
 */
function cleanCliSegments(segments: readonly string[]): string[] {
  const withoutById = segments.reduce<string[]>((acc, seg, i) => {
    if (seg === "by" && i + 1 < segments.length && segments[i + 1] === "id") {
      return acc;
    }
    if (seg === "id" && i > 0 && segments[i - 1] === "by") {
      return acc;
    }
    return [...acc, seg];
  }, []);

  return withoutById.reduce<string[]>((acc, seg) => {
    if (acc.length === 0 || acc[acc.length - 1] !== seg) {
      return [...acc, seg];
    }
    return acc;
  }, []);
}

/**
 * Converts a camelCase method name and HTTP method into a kebab-case CLI command name
 *
 * - Strips api/v2/v3 style prefixes from the name
 * - For GET endpoints: drops the "get-" prefix (GET is the implied default)
 * - For POST: uses "create-"
 * - For PUT/PATCH: uses "update-"
 * - For DELETE: uses "delete-"
 * - Deduplicates consecutive identical segments
 * @param methodName - the camelCase method name from pathToMethodName
 * @param httpMethod - the HTTP method (GET, POST, etc.)
 * @returns a kebab-case CLI command name like "users" or "create-user"
 */
export function methodNameToCliCommand(
  methodName: string,
  httpMethod: string
): string {
  const parts = methodName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split("-");

  const verb = verbForMethod(httpMethod);
  const filtered = stripPrefixes(parts, verb);
  const deduped = cleanCliSegments(filtered);

  const upperMethod = httpMethod.toUpperCase();
  const base = deduped.join("-");

  if (upperMethod === "GET") {
    return base || "get";
  }

  const prefix = verbForMethod(httpMethod);
  if (!base) return prefix;
  return `${prefix}-${base}`;
}

/**
 * Naive singularization: remove trailing 's' if present
 * @param word - the word to singularize
 * @returns the singular form of the word
 */
export function singularize(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Converts camelCase to kebab-case: "listingId" → "listing-id"
 * @param str - the camelCase string to convert
 * @returns the kebab-case form
 */
export function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Converts kebab-case to camelCase: "listing-id" → "listingId"
 * @param str - the kebab-case string to convert
 * @returns the camelCase form
 */
export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
