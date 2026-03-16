export type InputFormat = 'curl' | 'fetch' | 'har' | 'raw-http' | 'unknown';

export function detectFormat(input: string): InputFormat {
  const trimmed = input.trim();

  // Detect cURL commands
  if (/(?:^|\n)\s*curl\s/m.test(trimmed)) {
    return 'curl';
  }

  // Detect fetch() calls
  if (/(?:^|\n)\s*(?:await\s+)?fetch\s*\(/m.test(trimmed)) {
    return 'fetch';
  }

  // Detect HAR JSON
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.log?.entries && Array.isArray(parsed.log.entries)) {
      return 'har';
    }
  } catch {
    // Not JSON, continue
  }

  // Detect raw HTTP: "METHOD /path" or "HTTP/1.1" or "HTTP/2"
  if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+/m.test(trimmed)) {
    return 'raw-http';
  }
  if (/^HTTP\/[12]/m.test(trimmed)) {
    return 'raw-http';
  }

  return 'unknown';
}
