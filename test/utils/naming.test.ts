import { describe, it, expect } from 'vitest';
import { pathToMethodName, pathToTypeName } from '../../src/utils/naming.js';

describe('pathToMethodName', () => {
  it('generates GET collection method name', () => {
    expect(pathToMethodName('GET', '/users')).toBe('getUsers');
  });

  it('generates GET by ID method name', () => {
    expect(pathToMethodName('GET', '/users/:id')).toBe('getUsersById');
  });

  it('generates POST method name', () => {
    expect(pathToMethodName('POST', '/users')).toBe('createUsers');
  });

  it('generates PUT method name', () => {
    expect(pathToMethodName('PUT', '/users/:id')).toBe('updateUsersById');
  });

  it('generates DELETE method name', () => {
    expect(pathToMethodName('DELETE', '/users/:id')).toBe('deleteUsersById');
  });

  it('generates PATCH method name', () => {
    expect(pathToMethodName('PATCH', '/users/:id')).toBe('updateUsersById');
  });

  it('handles nested resources', () => {
    expect(pathToMethodName('GET', '/users/:id/posts')).toBe('getUsersPostsById');
  });

  it('handles paths with hyphens', () => {
    expect(pathToMethodName('GET', '/user-profiles')).toBe('getUserProfiles');
  });
});

describe('pathToTypeName', () => {
  it('generates response type name for GET collection', () => {
    expect(pathToTypeName('GET', '/users')).toBe('GetUsersResponse');
  });

  it('generates response type name for GET by ID', () => {
    expect(pathToTypeName('GET', '/users/:id')).toBe('GetUsersByIdResponse');
  });

  it('generates response type name for POST', () => {
    expect(pathToTypeName('POST', '/users')).toBe('CreateUsersResponse');
  });
});
