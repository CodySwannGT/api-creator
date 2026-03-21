/**
 * Infers a human-readable group name for an endpoint based on its path or
 * GraphQL operation name. Used to organize CLI --help output into sections.
 */

import { cleanSegment } from "./naming.js";

/** Verb prefixes stripped from GraphQL operation names. */
const VERB_PREFIXES = new Set([
  "get",
  "create",
  "update",
  "delete",
  "fetch",
  "set",
  "remove",
  "list",
  "search",
  "check",
  "is",
  "record",
]);

/** Domain-noise prefixes stripped from GraphQL operation names. */
const NOISE_PREFIXES = new Set([
  "host",
  "unified",
  "mys",
  "abbi",
  "navi",
  "viaduct",
  "user",
  "stay",
]);

/** Suffixes stripped from GraphQL operation names. */
const SUFFIXES = new Set([
  "query",
  "mutation",
  "subscription",
  "tab",
  "modal",
  "page",
  "web",
  "count",
  "counts",
  "data",
  "info",
  "config",
  "server",
]);

/** Path segments that carry no grouping information. */
const NOISE_SEGMENTS = new Set(["api", ""]);

/** Version prefix pattern (v1, v2, v3, etc.). */
const VERSION_RE = /^v\d+$/;

/**
 * Capitalizes the first letter of a word, lowercasing the rest.
 * @param word - the word to capitalize
 * @returns the capitalized word
 */
const capitalize = (word: string): string =>
  word.length === 0
    ? word
    : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;

/**
 * Splits a string on PascalCase/camelCase boundaries into lowercase words.
 * @param name - the string to split
 * @returns array of lowercase words
 */
const splitCamelCase = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .map(w => w.toLowerCase());

/**
 * Infers a group name from a GraphQL operation name by stripping verb prefixes,
 * noise prefixes, and suffixes, then taking the first remaining meaningful word.
 * @param operationName - the GraphQL operation name
 * @returns a capitalized group name or "Other"
 */
const inferGraphQLGroup = (operationName: string): string => {
  const words = splitCamelCase(operationName);

  const meaningful = words.filter(
    w => !VERB_PREFIXES.has(w) && !NOISE_PREFIXES.has(w) && !SUFFIXES.has(w)
  );

  const firstWord = meaningful.find(w => w.length > 2);

  return firstWord ? capitalize(firstWord) : "Other";
};

/**
 * Infers a group name from a REST path by taking the first meaningful segment
 * after stripping api/version/id noise.
 * @param normalizedPath - the endpoint path
 * @returns a capitalized group name or "Other"
 */
const inferRestGroup = (normalizedPath: string): string => {
  const segments = normalizedPath
    .split("/")
    .filter(
      s =>
        s !== "" && s !== ":id" && !NOISE_SEGMENTS.has(s) && !VERSION_RE.test(s)
    );

  const firstSegment = segments[0];
  if (!firstSegment) return "Other";

  const words = cleanSegment(firstSegment);
  const firstWord = words[0];

  return firstWord ? capitalize(firstWord) : "Other";
};

/**
 * Infers a human-readable group name for an endpoint.
 * @param normalizedPath - the endpoint's normalized URL path
 * @param isGraphQL - whether this is a GraphQL endpoint
 * @param operationName - the GraphQL operation name (only for GraphQL endpoints)
 * @returns a capitalized group name like "Reservations", "Auth", or "Other"
 */
export const inferGroup = (
  normalizedPath: string,
  isGraphQL: boolean,
  operationName?: string
): string => {
  if (isGraphQL) {
    return operationName ? inferGraphQLGroup(operationName) : "Other";
  }
  return inferRestGroup(normalizedPath);
};
