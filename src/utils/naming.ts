/** Matches a long hex hash (40+ hex characters) — e.g. GraphQL persisted query hashes. */
const LONG_HEX_HASH_RE = /^[0-9a-f]{40,}$/i;

/** Common file extensions to strip from path segments. */
const FILE_EXT_RE = /\.(json|js|mjs|html|htm|css|xml|txt|yaml|yml)$/i;

/**
 * Map HTTP method to a verb for method/type naming.
 * @param method
 */
function verbForMethod(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "get";
    case "POST":
      return "create";
    case "PUT":
      return "update";
    case "PATCH":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return method.toLowerCase();
  }
}

/**
 * Split a path into meaningful word segments, ignoring empty strings and `:id` placeholders.
 * Returns an array of lowercase words.
 * @param path
 */
function pathSegments(path: string): { words: string[]; hasId: boolean } {
  const segments = path.split("/").filter(s => s !== "");
  const words: string[] = [];
  let hasId = false;

  for (let seg of segments) {
    if (seg === ":id") {
      hasId = true;
      continue;
    }

    // Strip long hex hashes (GraphQL persisted query hashes)
    if (LONG_HEX_HASH_RE.test(seg)) {
      continue;
    }

    // Strip file extensions from segments
    seg = seg.replace(FILE_EXT_RE, "");

    // Replace dots with hyphen so "manifest.json" → "manifest" (after ext strip)
    // and "some.thing" → "some-thing" which splits below
    seg = seg.replace(/\./g, "-");

    // Split on hyphens or underscores to get individual words
    const parts = seg.split(/[-_]+/).filter(p => p !== "");

    for (const part of parts) {
      // Remove any remaining characters that are not valid in identifiers
      const clean = part.replace(/[^a-zA-Z0-9]/g, "");
      if (clean !== "") {
        // Strip leading digits to ensure valid identifier parts
        const noLeadingDigits = clean.replace(/^\d+/, "");
        if (noLeadingDigits !== "") {
          words.push(noLeadingDigits);
        }
      }
    }
  }

  return { words, hasId };
}

/**
 * Capitalize first letter of a string.
 * @param s
 */
function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Convert an HTTP method + path to a camelCase method name.
 *
 * Examples:
 *   GET /users/:id     → getUserById
 *   POST /users        → createUser
 *   PUT /users/:id     → updateUser
 *   DELETE /users/:id  → deleteUser
 *   GET /users         → getUsers
 *   GET /users/:id/posts/:id → getUserPostById
 * @param method
 * @param path
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
 * Convert an HTTP method + path to a PascalCase type name.
 *
 * Examples:
 *   GET /users         → GetUsersResponse
 *   POST /users        → CreateUserRequest / CreateUserResponse
 *   GET /users/:id     → GetUserByIdResponse
 * @param method
 * @param path
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
 * Convert a camelCase method name (as produced by pathToMethodName) and its
 * HTTP method into a kebab-case CLI command name.
 *
 * - Strips api/v2/v3 style prefixes from the name
 * - For GET endpoints: drops the "get-" prefix (GET is the implied default)
 * - For POST: uses "create-"
 * - For PUT/PATCH: uses "update-"
 * - For DELETE: uses "delete-"
 * - Deduplicates consecutive identical segments
 * @param methodName
 * @param httpMethod
 */
export function methodNameToCliCommand(
  methodName: string,
  httpMethod: string
): string {
  // Split camelCase into segments: "getApiV2UserMarkets" → ["get", "Api", "V2", "User", "Markets"]
  const parts = methodName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split("-");

  // Remove the verb prefix (first segment matches the HTTP verb mapping)
  const verb = verbForMethod(httpMethod);
  if (parts.length > 0 && parts[0] === verb) {
    parts.shift();
  }

  // Strip "api" and version segments like "v2", "v3"
  const filtered = parts.filter(p => {
    if (p === "api") return false;
    if (/^v\d+$/.test(p)) return false;
    return true;
  });

  // Strip "by-id" suffix — keep it simple
  const withoutById: string[] = [];
  for (let i = 0; i < filtered.length; i++) {
    if (
      filtered[i] === "by" &&
      i + 1 < filtered.length &&
      filtered[i + 1] === "id"
    ) {
      // skip "by" and "id"
      i++;
      continue;
    }
    withoutById.push(filtered[i]);
  }

  // Deduplicate consecutive identical segments
  const deduped: string[] = [];
  for (const seg of withoutById) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== seg) {
      deduped.push(seg);
    }
  }

  // Build the final command name with method-appropriate prefix
  const upperMethod = httpMethod.toUpperCase();
  const base = deduped.join("-");

  if (upperMethod === "GET") {
    // GET is the default action — no prefix needed
    return base || "get";
  }

  // For non-GET methods, add the verb prefix
  const prefix = verbForMethod(httpMethod);
  if (!base) return prefix;
  return `${prefix}-${base}`;
}
