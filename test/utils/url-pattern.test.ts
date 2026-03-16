import { describe, it, expect } from 'vitest';
import { normalizePath } from '../../src/utils/url-pattern.js';

describe('normalizePath', () => {
  it('replaces numeric IDs with :id', () => {
    expect(normalizePath('/users/42')).toBe('/users/:id');
  });

  it('replaces UUIDs with :id', () => {
    expect(normalizePath('/users/550e8400-e29b-41d4-a716-446655440000')).toBe('/users/:id');
  });

  it('replaces multiple ID segments', () => {
    expect(normalizePath('/users/42/posts/99')).toBe('/users/:id/posts/:id');
  });

  it('preserves non-ID path segments', () => {
    expect(normalizePath('/api/v1/users')).toBe('/api/v1/users');
  });

  it('strips trailing slash', () => {
    expect(normalizePath('/users/')).toBe('/users');
  });

  it('keeps root path as-is', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('handles mixed numeric and UUID IDs', () => {
    expect(normalizePath('/orgs/123/members/a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
      '/orgs/:id/members/:id',
    );
  });
});
