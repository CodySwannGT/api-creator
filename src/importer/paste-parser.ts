import type { HarEntry, HarHeader, HarRequest, HarResponse } from '../types/har.js';

function makeDefaultResponse(): HarResponse {
  return {
    status: 0,
    statusText: '',
    httpVersion: 'HTTP/1.1',
    headers: [],
    content: { size: 0, mimeType: '' },
    redirectURL: '',
    headersSize: -1,
    bodySize: -1,
    cookies: [],
  };
}

function makeEntry(request: HarRequest): HarEntry {
  return {
    startedDateTime: new Date().toISOString(),
    time: 0,
    request,
    response: makeDefaultResponse(),
  };
}

function parseQueryString(url: string): { name: string; value: string }[] {
  try {
    const parsed = new URL(url);
    const params: { name: string; value: string }[] = [];
    parsed.searchParams.forEach((value, name) => {
      params.push({ name, value });
    });
    return params;
  } catch {
    return [];
  }
}

function inferMimeType(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'application/json';
  }
  if (trimmed.includes('=') && !trimmed.includes('<')) {
    return 'application/x-www-form-urlencoded';
  }
  return 'text/plain';
}

// --- cURL Parser ---

function splitCurlCommands(input: string): string[] {
  // Join backslash-continued lines first
  const joined = input.replace(/\\\s*\n/g, ' ');
  // Split on lines starting with curl
  const commands: string[] = [];
  for (const line of joined.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('curl ')) {
      commands.push(trimmed);
    } else if (commands.length > 0 && trimmed) {
      // Append continuation to the last command
      commands[commands.length - 1] += ' ' + trimmed;
    }
  }
  return commands.filter(Boolean);
}

function tokenizeCurl(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  // Strip leading "curl "
  const input = command.replace(/^\s*curl\s+/, '');

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseSingleCurl(command: string): HarEntry {
  const tokens = tokenizeCurl(command);

  let method = 'GET';
  let url = '';
  const headers: HarHeader[] = [];
  let body: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '-X' || token === '--request') {
      method = tokens[++i]?.toUpperCase() ?? method;
    } else if (token === '-H' || token === '--header') {
      const headerStr = tokens[++i];
      if (headerStr) {
        const colonIdx = headerStr.indexOf(':');
        if (colonIdx !== -1) {
          headers.push({
            name: headerStr.slice(0, colonIdx).trim(),
            value: headerStr.slice(colonIdx + 1).trim(),
          });
        }
      }
    } else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
      body = tokens[++i];
      if (method === 'GET') {
        method = 'POST';
      }
    } else if (token.startsWith('-d')) {
      // Handle -d'data' (no space)
      body = token.slice(2);
      if (method === 'GET') {
        method = 'POST';
      }
    } else if (!token.startsWith('-') && !url) {
      url = token;
    } else if (token === '--url') {
      url = tokens[++i] ?? url;
    } else if (token === '--compressed' || token === '-s' || token === '-S'
      || token === '-k' || token === '--insecure' || token === '-L'
      || token === '--location' || token === '-v' || token === '--verbose') {
      // Skip known boolean flags
    }
  }

  const request: HarRequest = {
    method,
    url,
    httpVersion: 'HTTP/1.1',
    headers,
    queryString: parseQueryString(url),
    headersSize: -1,
    bodySize: body ? body.length : 0,
    cookies: [],
  };

  if (body) {
    request.postData = {
      mimeType: headers.find(h => h.name.toLowerCase() === 'content-type')?.value ?? inferMimeType(body),
      text: body,
    };
  }

  return makeEntry(request);
}

function parseCurl(input: string): HarEntry[] {
  const commands = splitCurlCommands(input);
  return commands.map(parseSingleCurl);
}

// --- fetch() Parser ---

function parseFetch(input: string): HarEntry[] {
  const entries: HarEntry[] = [];

  // Match fetch calls — supports multiline with dotAll
  const fetchRegex = /(?:await\s+)?fetch\s*\(\s*([\s\S]*?)\)\s*;?/g;
  let match: RegExpExecArray | null;

  while ((match = fetchRegex.exec(input)) !== null) {
    const argsStr = match[1];
    const entry = parseSingleFetch(argsStr);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function extractStringLiteral(str: string): { value: string; rest: string } | null {
  const trimmed = str.trim();
  const quote = trimmed[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    return null;
  }
  let i = 1;
  let value = '';
  while (i < trimmed.length) {
    if (trimmed[i] === '\\') {
      i++;
      value += trimmed[i] ?? '';
    } else if (trimmed[i] === quote) {
      return { value, rest: trimmed.slice(i + 1).trim() };
    } else {
      value += trimmed[i];
    }
    i++;
  }
  return { value, rest: '' };
}

function parseSingleFetch(argsStr: string): HarEntry | null {
  // Extract URL (first argument — a string literal)
  const urlResult = extractStringLiteral(argsStr);
  if (!urlResult) return null;

  const url = urlResult.value;
  let method = 'GET';
  const headers: HarHeader[] = [];
  let body: string | undefined;

  // Look for options object after the URL
  const rest = urlResult.rest.replace(/^\s*,\s*/, '');
  if (rest.startsWith('{')) {
    // Extract method
    const methodMatch = rest.match(/method\s*:\s*["'`](\w+)["'`]/);
    if (methodMatch) {
      method = methodMatch[1].toUpperCase();
    }

    // Extract headers from headers object
    const headersMatch = rest.match(/headers\s*:\s*\{([^}]*)\}/s);
    if (headersMatch) {
      const headersBlock = headersMatch[1];
      const headerPairRegex = /["'`]?([^"'`:\s,]+)["'`]?\s*:\s*["'`]([^"'`]*)["'`]/g;
      let hMatch: RegExpExecArray | null;
      while ((hMatch = headerPairRegex.exec(headersBlock)) !== null) {
        headers.push({ name: hMatch[1], value: hMatch[2] });
      }
    }

    // Extract body
    const bodyMatch = rest.match(/body\s*:\s*["'`]([\s\S]*?)["'`]/);
    if (bodyMatch) {
      body = bodyMatch[1];
    } else {
      // Try JSON.stringify style: body: JSON.stringify(...)
      const jsonBodyMatch = rest.match(/body\s*:\s*JSON\.stringify\s*\(\s*([\s\S]*?)\s*\)\s*[,}]/);
      if (jsonBodyMatch) {
        body = jsonBodyMatch[1];
      }
    }
  }

  const request: HarRequest = {
    method,
    url,
    httpVersion: 'HTTP/1.1',
    headers,
    queryString: parseQueryString(url),
    headersSize: -1,
    bodySize: body ? body.length : 0,
    cookies: [],
  };

  if (body) {
    request.postData = {
      mimeType: headers.find(h => h.name.toLowerCase() === 'content-type')?.value ?? inferMimeType(body),
      text: body,
    };
  }

  return makeEntry(request);
}

// --- Raw HTTP Parser ---

function parseRawHttp(input: string): HarEntry[] {
  // Split on double-newline-then-HTTP-method pattern to find multiple requests
  const blocks = input.split(/\n(?=(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s)/);
  return blocks.map(parseSingleRawHttp).filter((e): e is HarEntry => e !== null);
}

function parseSingleRawHttp(block: string): HarEntry | null {
  const lines = block.split('\n');
  if (lines.length === 0) return null;

  const requestLine = lines[0].trim();
  const requestLineMatch = requestLine.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)(?:\s+(HTTP\/\S+))?/);
  if (!requestLineMatch) return null;

  const method = requestLineMatch[1];
  let path = requestLineMatch[2];
  const httpVersion = requestLineMatch[3] ?? 'HTTP/1.1';

  const headers: HarHeader[] = [];
  let bodyStart = -1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      bodyStart = i + 1;
      break;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      headers.push({
        name: line.slice(0, colonIdx).trim(),
        value: line.slice(colonIdx + 1).trim(),
      });
    }
  }

  const body = bodyStart > 0 ? lines.slice(bodyStart).join('\n').trim() : undefined;

  // If path is relative, try to construct URL from Host header
  let url = path;
  if (!path.startsWith('http')) {
    const hostHeader = headers.find(h => h.name.toLowerCase() === 'host');
    if (hostHeader) {
      url = `https://${hostHeader.value}${path}`;
    }
  }

  const request: HarRequest = {
    method,
    url,
    httpVersion,
    headers,
    queryString: parseQueryString(url),
    headersSize: -1,
    bodySize: body ? body.length : 0,
    cookies: [],
  };

  if (body) {
    request.postData = {
      mimeType: headers.find(h => h.name.toLowerCase() === 'content-type')?.value ?? inferMimeType(body),
      text: body,
    };
  }

  return makeEntry(request);
}

// --- HAR Parser ---

function parseHar(input: string): HarEntry[] {
  try {
    const parsed = JSON.parse(input);
    if (parsed?.log?.entries && Array.isArray(parsed.log.entries)) {
      return parsed.log.entries;
    }
  } catch {
    // Invalid JSON
  }
  return [];
}

// --- Main export ---

export function parseInput(input: string, format: string): HarEntry[] {
  switch (format) {
    case 'curl':
      return parseCurl(input);
    case 'fetch':
      return parseFetch(input);
    case 'raw-http':
      return parseRawHttp(input);
    case 'har':
      return parseHar(input);
    default:
      return [];
  }
}
