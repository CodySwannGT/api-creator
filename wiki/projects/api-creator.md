---
type: project
created: 2026-05-28
updated: 2026-05-28
related: ["../architecture/pipeline-overview.md", "../concepts/har-to-cli.md"]
sources: ["../sources/git/2026-05-28-api-creator-git.md", "../sources/roles/2026-05-28-roles.md"]
sensitivity: internal
---

# api-creator

## Repository
| Field | Value |
|---|---|
| Package | `@codyswann/api-creator` (npm) |
| Remote | `CodySwannGT/api-creator` |
| Default branch | `main` |
| HEAD (at ingest) | `7509d52` |
| Status | Active; 69 commits on HEAD, latest merged PR #42 |
| Bin | `api-creator` (`./bin/api-creator.js`) |

## Technology signals
- TypeScript CLI distributed on npm; runtime entry `./dist/cli.js`.
- Playwright for browser recording and auth capture.
- Bun-based toolchain; governed by `@codyswann/lisa` (bumped to `^2.62.1`).
- Generated CLI projects land in `./services/<name>/`; recordings/auth under `~/.api-creator/`.

## Structure signals
Pipeline stages map to `src/` subdirectories: `recorder/`, `parser/`, `generator/`, `runtime/`,
`importer/`, `commands/`, plus shared `utils/` and `types/`. See
[architecture/pipeline-overview.md](../architecture/pipeline-overview.md).

## Notes & evidence
- The repo's git history is dominated by routine `@codyswann/lisa` dependency bumps; substantive
  feature work includes the initial release (fcf45ed), npm publishing pipeline (PR #1), improved
  project storage/naming (PR #7), and endpoint grouping (PR #8).
- A standard digital-staff roster (chief, sally, mark, felix, casey, parker, lex) was seeded at wiki
  setup. Source: sources/roles/2026-05-28-roles.md.

Source: sources/git/2026-05-28-api-creator-git.md
