---
type: architecture
created: 2026-05-28
updated: 2026-05-28
related: ["../concepts/har-to-cli.md", "../projects/api-creator.md"]
sources: ["../sources/git/2026-05-28-api-creator-git.md"]
sensitivity: internal
---

# api-creator pipeline architecture

## Overview
api-creator turns recorded browser traffic into a typed command-line interface for an otherwise
undocumented web API. The system is organized as a linear pipeline — **record → parse → generate →
run** — backed by a small set of supporting modules (importer, runtime, utils, types).

## Components
Derived from the `src/` layout:

| Stage | Module(s) | Responsibility |
|---|---|---|
| Record | `src/recorder/` (`browser-session`, `network-capture`, `auth-capture`) | Drive a Playwright browser, capture API traffic as HAR, capture auth via a login flow. |
| Parse | `src/parser/` (`har-reader`, `auth-detector`, `type-inferrer`, `property-inferrer`, `endpoint-grouper`) | Extract endpoints from the HAR, detect the auth pattern, infer TypeScript types, group related endpoints. |
| Generate | `src/generator/` (`codegen`, `cli-project-emitter`, `commands-emitter`, `client-emitter`, `auth-emitter`, `graphql-commands-emitter`, `diff-merger`, `types-emitter`) | Emit a standalone typed CLI project + programmatic client from the parsed manifest. |
| Run | `src/runtime/` (`project-manager`, `project-runner`, `endpoint-command-builder`, `http-client`, `curl-parser`) | Register generated projects as dynamic subcommands and execute endpoint calls with injected auth. |
| Import | `src/importer/` (`format-detector`, `paste-parser`, `paste-parser-http`) | Accept alternate inputs (e.g. pasted cURL / raw HTTP) beyond recorded HAR. |
| Commands | `src/commands/` (`record`, `generate`, `export`, `test`) | The user-facing CLI verbs wired in `src/cli.ts`. |
| Shared | `src/utils/` (`url-pattern`, `group-inferrer`, `naming`), `src/types/` (`har`, `endpoint`, `auth`) | URL/path patterns, endpoint group inference, command naming (dasherize camelCase), shared type contracts. |

## Data flow
1. `record` opens a Playwright browser; `network-capture` writes a HAR under `~/.api-creator/recordings/`.
2. `generate` reads the HAR (`har-reader`), detects auth (`auth-detector`), infers types
   (`type-inferrer`/`property-inferrer`), and groups endpoints (`endpoint-grouper` + `group-inferrer`
   heuristic) into a project manifest.
3. The generator emits a CLI project into `./services/<name>/`, including a typed client and per-endpoint
   subcommands; `export` produces a standalone TypeScript client for programmatic use.
4. At runtime, `project-manager` registers each generated project as a dynamic `api-creator <name>`
   subcommand; `http-client` injects captured auth (cookies / bearer / API key / custom headers) into
   every request.

## Constraints & decisions
- GraphQL persisted queries are detected automatically; `operationName` + `extensions` are baked into
  the manifest and only meaningful variables are exposed as options.
- Generated projects moved from `~/.api-creator/projects/` to in-repo `./services/` (commit b7f0810).
- Recordings/auth files are gitignored (commit 5cb62fd).
- Design decision records will be captured under the `decisions` category as they arise.

Source: sources/git/2026-05-28-api-creator-git.md
