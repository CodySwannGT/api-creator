# Plan: Automatic Endpoint Grouping

## Context

When running `api-creator airbnb --help`, all 95 endpoints display as a flat list — unusable at scale. We need to automatically infer logical groups from endpoint paths and GraphQL operation names, then use Commander.js v14's native `.helpGroup()` to display them in categorized sections.

## Approach

Two-part change: (1) infer a `group` string per endpoint at generate time and store it in the manifest, (2) apply `.helpGroup()` at runtime when registering subcommands.

## Files to Change

### New Files

| File | Purpose |
|------|---------|
| `src/utils/group-inferrer.ts` | `inferGroup(path, isGraphQL, operationName?) → string` |
| `tests/utils/group-inferrer.test.ts` | Tests for group inference |

### Modified Files

| File | Change |
|------|--------|
| `src/runtime/project-manager.ts` | Add `group?: string` to `ManifestEndpoint` |
| `src/utils/naming.ts` | Export `cleanSegment` (add `export` keyword) |
| `src/generator/codegen.ts` | Import `inferGroup`, call it in `buildManifestEndpoint`, pass to GraphQL builder |
| `src/runtime/endpoint-command-builder.ts` | Call `cmd.helpGroup(endpoint.group)` when group exists |
| `tests/runtime/endpoint-command-builder.test.ts` | Add tests for helpGroup behavior |
| `tests/generator/codegen.test.ts` | Expect `group` field on manifest endpoints |

## Implementation Steps (TDD order)

### 1. Export `cleanSegment` from `src/utils/naming.ts`

Add `export` keyword to the existing `function cleanSegment` declaration (line 34). Zero lines added.

### 2. Write `tests/utils/group-inferrer.test.ts`

Test cases covering both REST and GraphQL:

**REST** (group from first meaningful path segment after stripping `api`/`v\d+`/`:id`):
- `/api/v2/auth/options` → `"Auth"`
- `/api/v2/client_configs` → `"Client"`
- `/track/realtimeconversion` → `"Track"`
- `/users/:id/posts` → `"Users"`
- `/` → `"Other"`

**GraphQL** (group from operation name after stripping verb/noise prefixes and Query/Mutation/Subscription suffixes):
- `HostReservationsTabQuery` → `"Reservations"`
- `GetListOfListings` → `"Listings"`
- `MYSArrivalQuery` → `"Arrival"`
- `UserMetastoreWebQuery` → `"Metastore"`
- `CohostManagementListQuery` → `"Management"`
- `ViaductInboxData` → `"Inbox"`
- `multicalBootstrap` → `"Multical"`
- `undefined` → `"Other"`

### 3. Create `src/utils/group-inferrer.ts`

Single exported function:

```
inferGroup(normalizedPath: string, isGraphQL: boolean, operationName?: string): string
```

**GraphQL logic:**
1. If no operationName, return `"Other"`
2. Split operationName on PascalCase/camelCase boundaries into words
3. Strip verb prefixes: `Get`, `Create`, `Update`, `Delete`, `Fetch`, `Set`, `Remove`, `List`, `Search`, `Check`, `Is`
4. Strip Airbnb-specific noise prefixes (harmless generically): `Host`, `Unified`, `Mys`, `MYS`, `Abbi`, `Navi`
5. Strip suffixes: `Query`, `Mutation`, `Subscription`, `Tab`, `Modal`, `Page`, `Web`, `Count`, `Counts`
6. Take first remaining word, capitalize it
7. If nothing remains, return `"Other"`

**REST logic:**
1. Split path on `/`, filter empties
2. Strip noise segments: `api`, version prefixes (`v\d+`), `:id`
3. Take first remaining segment
4. Split on camelCase (reuse exported `cleanSegment`), take first word, capitalize
5. If nothing remains, return `"Other"`

### 4. Add `group?: string` to `ManifestEndpoint`

In `src/runtime/project-manager.ts`, add `group?: string` to the interface. Optional for backward compatibility with existing manifests.

### 5. Wire `inferGroup` into codegen

In `src/generator/codegen.ts`:
- Import `inferGroup` from `../utils/group-inferrer.js`
- In `buildManifestEndpoint()`: compute `group` after `isGraphQL` is determined, add to REST return object
- Pass `group` to `buildGraphQLManifestEndpoint()`, add to its return object

### 6. Wire `.helpGroup()` into endpoint registration

In `src/runtime/endpoint-command-builder.ts`, after creating the command:
```typescript
if (endpoint.group) {
  cmd.helpGroup(endpoint.group);
}
```

### 7. Update existing tests

- `tests/generator/codegen.test.ts`: Add `group` to expected manifest endpoint shape
- `tests/runtime/endpoint-command-builder.test.ts`: Test that helpGroup is set/unset correctly

### 8. Rebuild and regenerate Airbnb service

```bash
npm run build
rm services/airbnb/manifest.json
node bin/api-creator.js generate --name airbnb --input ./recordings/1774122210764.har
```

## Verification

1. `npm test` — all tests pass
2. `npm run build` — builds clean
3. `node bin/api-creator.js airbnb --help` — endpoints appear grouped by category instead of flat
4. `node bin/api-creator.js airbnb get-list-of-listings` — still works (runtime unaffected)
5. Generate a fresh project without existing manifest — group field populated
6. Generate over existing manifest — group field preserved via merge
