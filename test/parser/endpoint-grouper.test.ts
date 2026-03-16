import { describe, it, expect } from 'vitest';
import { groupEndpoints } from '../../src/parser/endpoint-grouper.js';
import type { HarEntry } from '../../src/types/har.js';

function makeEntry(
  method: string,
  url: string,
  opts?: {
    queryString?: { name: string; value: string }[];
    responseBody?: string;
    requestBody?: string;
  },
): HarEntry {
  return {
    startedDateTime: new Date().toISOString(),
    time: 0,
    request: {
      method,
      url,
      httpVersion: 'HTTP/1.1',
      headers: [],
      queryString: opts?.queryString ?? [],
      headersSize: -1,
      bodySize: opts?.requestBody ? opts.requestBody.length : 0,
      cookies: [],
      ...(opts?.requestBody
        ? { postData: { mimeType: 'application/json', text: opts.requestBody } }
        : {}),
    },
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [],
      content: {
        size: opts?.responseBody?.length ?? 0,
        mimeType: 'application/json',
        text: opts?.responseBody,
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
      cookies: [],
    },
  };
}

describe('groupEndpoints', () => {
  it('groups by method + path', () => {
    const entries = [
      makeEntry('GET', 'https://api.example.com/users'),
      makeEntry('POST', 'https://api.example.com/users'),
    ];
    const result = groupEndpoints(entries);
    expect(result.endpoints).toHaveLength(2);
    expect(result.endpoints.map((e) => e.method).sort()).toEqual(['GET', 'POST']);
  });

  it('normalizes numeric IDs in paths', () => {
    const entries = [
      makeEntry('GET', 'https://api.example.com/users/42'),
      makeEntry('GET', 'https://api.example.com/users/99'),
    ];
    const result = groupEndpoints(entries);
    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].normalizedPath).toBe('/users/:id');
    expect(result.endpoints[0].originalUrls).toHaveLength(2);
  });

  it('collects query params across requests', () => {
    const entries = [
      makeEntry('GET', 'https://api.example.com/users?page=1', {
        queryString: [{ name: 'page', value: '1' }],
      }),
      makeEntry('GET', 'https://api.example.com/users?page=2', {
        queryString: [{ name: 'page', value: '2' }],
      }),
    ];
    const result = groupEndpoints(entries);
    expect(result.endpoints).toHaveLength(1);
    const qp = result.endpoints[0].queryParams.find((p) => p.name === 'page');
    expect(qp).toBeDefined();
    expect(qp!.observedValues).toContain('1');
    expect(qp!.observedValues).toContain('2');
    expect(qp!.required).toBe(true);
  });

  it('groups multiple requests to same endpoint', () => {
    const entries = [
      makeEntry('GET', 'https://api.example.com/posts/1', {
        responseBody: '{"id":1,"title":"Hello"}',
      }),
      makeEntry('GET', 'https://api.example.com/posts/2', {
        responseBody: '{"id":2,"title":"World"}',
      }),
      makeEntry('GET', 'https://api.example.com/posts/3', {
        responseBody: '{"id":3,"title":"Test"}',
      }),
    ];
    const result = groupEndpoints(entries);
    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].responseBodies).toHaveLength(3);
  });

  it('extracts the most common base URL', () => {
    const entries = [
      makeEntry('GET', 'https://api.example.com/a'),
      makeEntry('GET', 'https://api.example.com/b'),
      makeEntry('GET', 'https://other.example.com/c'),
    ];
    const result = groupEndpoints(entries);
    expect(result.baseUrl).toBe('https://api.example.com');
  });
});
