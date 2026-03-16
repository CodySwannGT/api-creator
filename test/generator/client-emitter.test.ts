import { describe, it, expect } from 'vitest';
import { emitClient } from '../../src/generator/client-emitter.js';
import type { Endpoint } from '../../src/types/endpoint.js';
import type { AuthInfo } from '../../src/types/auth.js';
import type { TypeDefinition } from '../../src/parser/type-inferrer.js';

function makeEndpoint(method: string, path: string): Endpoint {
  return {
    method,
    normalizedPath: path,
    originalUrls: [`https://api.example.com${path}`],
    queryParams: [],
    requestBodies: [],
    responseBodies: [],
    responseStatuses: [200],
    headers: {},
  };
}

describe('emitClient', () => {
  const baseEndpoints: Endpoint[] = [
    makeEndpoint('GET', '/users'),
    makeEndpoint('POST', '/users'),
    makeEndpoint('GET', '/users/:id'),
  ];

  const baseAuth: AuthInfo[] = [
    { type: 'bearer', location: 'header', key: 'Authorization', value: 'Bearer tok', confidence: 1.0 },
  ];

  it('generates a class definition', () => {
    const code = emitClient({
      endpoints: baseEndpoints,
      types: [],
      requestTypes: [],
      auth: [],
      baseUrl: 'https://api.example.com',
    });
    expect(code).toContain('export class ApiClient {');
    expect(code).toContain('constructor(');
  });

  it('includes custom class name', () => {
    const code = emitClient({
      endpoints: baseEndpoints,
      types: [],
      requestTypes: [],
      auth: [],
      baseUrl: 'https://api.example.com',
      name: 'MyService',
    });
    expect(code).toContain('export class MyService {');
  });

  it('includes healthCheck method', () => {
    const code = emitClient({
      endpoints: baseEndpoints,
      types: [],
      requestTypes: [],
      auth: [],
      baseUrl: 'https://api.example.com',
    });
    expect(code).toContain('async healthCheck()');
    expect(code).toContain('HealthCheckResult');
  });

  it('includes SESSION_HELP constant', () => {
    const code = emitClient({
      endpoints: baseEndpoints,
      types: [],
      requestTypes: [],
      auth: [],
      baseUrl: 'https://api.example.com',
    });
    expect(code).toContain('export const SESSION_HELP =');
  });

  it('generates methods for endpoints', () => {
    const code = emitClient({
      endpoints: baseEndpoints,
      types: [],
      requestTypes: [],
      auth: [],
      baseUrl: 'https://api.example.com',
    });
    expect(code).toContain('async getUsers(');
    expect(code).toContain('async createUsers(');
    expect(code).toContain('async getUsersById(');
  });

  it('injects bearer auth into _fetch helper', () => {
    const code = emitClient({
      endpoints: baseEndpoints,
      types: [],
      requestTypes: [],
      auth: baseAuth,
      baseUrl: 'https://api.example.com',
    });
    expect(code).toContain('this.auth.token');
    expect(code).toContain("'Authorization'");
    expect(code).toContain('Bearer');
  });

  it('injects cookie auth when detected', () => {
    const cookieAuth: AuthInfo[] = [
      { type: 'cookie', location: 'cookie', key: 'session', value: 'sess123', confidence: 0.8 },
    ];
    const code = emitClient({
      endpoints: baseEndpoints,
      types: [],
      requestTypes: [],
      auth: cookieAuth,
      baseUrl: 'https://api.example.com',
    });
    expect(code).toContain('this.auth.cookie');
    expect(code).toContain("'Cookie'");
  });

  it('injects api-key auth when detected', () => {
    const apiKeyAuth: AuthInfo[] = [
      { type: 'api-key', location: 'header', key: 'X-API-Key', value: 'key123', confidence: 0.7 },
    ];
    const code = emitClient({
      endpoints: baseEndpoints,
      types: [],
      requestTypes: [],
      auth: apiKeyAuth,
      baseUrl: 'https://api.example.com',
    });
    expect(code).toContain('this.auth.apiKey');
    expect(code).toContain("'X-API-Key'");
  });
});
