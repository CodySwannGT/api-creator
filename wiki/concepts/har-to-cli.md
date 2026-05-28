---
type: concept
created: 2026-05-28
updated: 2026-05-28
related: ["../architecture/pipeline-overview.md"]
sources: ["../sources/git/2026-05-28-api-creator-git.md"]
sensitivity: internal
---

# HAR-to-CLI generation

## Definition
The core idea of api-creator: a recorded **HAR** (HTTP Archive) of a real browser session is the
specification from which a typed CLI is mechanically generated. Rather than hand-writing an API
client, the tool observes real traffic and reverse-engineers endpoints, types, and auth from it.

## Key points
- A HAR captured by Playwright is the single source of truth for what endpoints exist and what their
  request/response shapes are.
- TypeScript types are **inferred** from observed request/response bodies, not declared.
- Auth is **detected** from the traffic (cookies, bearer tokens, API keys, custom headers) and
  captured separately via an interactive login flow.
- Endpoints are **grouped** automatically via an `inferGroup` heuristic so the generated `--help`
  output is navigable (commit 614b229, c405754).
- Command names are derived by dasherizing camelCase path/operation segments (commit acf2fdd).
- GraphQL persisted queries are a first-class case: detected automatically, with operation metadata
  baked in.

## Evidence
Source: sources/git/2026-05-28-api-creator-git.md (initial release fcf45ed; endpoint grouping feature
PR #8; naming/dasherize work commit acf2fdd).

## Open questions
- Unresolved type-inference and auth-refresh edge cases will be tracked under the `open-questions`
  category as they surface.
