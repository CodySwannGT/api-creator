/**
 * Recognized input formats for API request import
 */
export type InputFormat = "curl" | "fetch" | "har" | "raw-http" | "unknown";

/**
 * Detects the format of pasted API request text by checking for known patterns
 * @param input - the raw text input to classify
 * @returns the detected input format
 */
export function detectFormat(input: string): InputFormat {
  const trimmed = input.trim();

  // Detect cURL commands
  if (trimmed.split("\n").some(line => /^\s*curl\s/.test(line))) {
    return "curl";
  }

  // Detect fetch() calls
  if (trimmed.split("\n").some(line => /^\s*(?:await )?fetch\(/.test(line))) {
    return "fetch";
  }

  // Detect HAR JSON
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.log?.entries && Array.isArray(parsed.log.entries)) {
      return "har";
    }
  } catch {
    // Not JSON, continue
  }

  // Detect raw HTTP: "METHOD /path" or "HTTP/1.1" or "HTTP/2"
  if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+/m.test(trimmed)) {
    return "raw-http";
  }
  if (/^HTTP\/[12]/m.test(trimmed)) {
    return "raw-http";
  }

  return "unknown";
}
