---
name: manage-cli
description: "How to create or update a CLI for any web service using api-creator. Use this skill whenever the user wants to: add a new service/API, re-record traffic for an existing service, regenerate endpoints, set up or refresh auth, test API calls, troubleshoot endpoint issues, or understand the api-creator project structure. Also use when the user mentions recording, HAR files, manifests, or Playwright in the context of this project."
---

# Managing CLIs with api-creator

api-creator reverse-engineers web APIs by capturing real browser traffic and generating typed TypeScript clients that run as dynamic subcommands of the `api-creator` CLI itself.

## End-to-end workflow

### 1. Record browser traffic

```bash
api-creator record --url https://example.com
```

This launches a Playwright Chromium browser, navigates to the URL, and records all network traffic to a HAR file. The user browses around to exercise the API endpoints they care about.

- Press "q" + Enter to stop recording (Ctrl+C is unreliable in some terminals)
- HAR files are saved to `./recordings/<timestamp>.har`
- Use `--output <dir>` to change the output directory
- Use `--include-assets` to also capture images, CSS, fonts (off by default)

Playwright must be installed first: `npx playwright install chromium`

### 2. Generate the project

```bash
api-creator generate --input ./recordings/<timestamp>.har --name <service>
```

This parses the HAR file, filters out tracking/analytics noise, detects auth patterns, groups endpoints, infers TypeScript types from response bodies, and saves everything to `~/.api-creator/projects/<name>/`.

The generate step produces:
- `manifest.json` — endpoint definitions, auth type, base URL, GraphQL metadata
- `client.ts` — typed TypeScript API client class
- `types.ts` — inferred TypeScript interfaces

If `--input` is omitted, it uses the most recent `.har` file in `./recordings/`.
If `--name` is omitted, it derives the name from the HAR filename or domain.

To update an existing project, just re-run generate with the same `--name` — it overwrites the existing manifest and client files.

### 3. Set up auth

```bash
api-creator <name> auth setup
```

This launches a Playwright browser to the service URL. The user logs in, then presses Enter in the terminal to confirm. The tool then captures cookies and auth headers (like `x-airbnb-api-key`) from the next several API requests and saves them to `~/.api-creator/<name>.auth`.

Alternative methods for auth setup:
- `api-creator <name> auth setup --file curl.txt` — parse auth from a saved cURL command
- `pbpaste | api-creator <name> auth setup --stdin` — pipe a cURL command from clipboard

Other auth commands:
- `api-creator <name> auth status` — check if auth is configured
- `api-creator <name> auth clear` — remove stored credentials

Auth tokens/cookies expire. When API calls start returning 401/403, re-run auth setup.

### 4. Use the CLI

Every generated project becomes a dynamic subcommand:

```bash
api-creator <name> --help              # list all endpoints
api-creator <name> <endpoint> --help   # see options for one endpoint
api-creator <name> <endpoint> [opts]   # make the API call
```

For GraphQL endpoints, `operationName` and `extensions` are baked into the manifest automatically. Only meaningful variable fields are exposed as CLI options (e.g., `--listing-id`, `--viewer-id`).

Options:
- `--raw` — output compact JSON instead of pretty-printed
- `--body <json>` or `--json <json>` — request body for POST/PUT/PATCH
- Path parameters become positional arguments

### 5. Other commands

- `api-creator list` — show all projects with endpoint counts and auth status
- `api-creator export <name> --output <dir>` — copy `client.ts` and `types.ts` for programmatic use in other projects

## Project structure

### Source code layout

```
src/
├── cli.ts                          # Entry point, registers commands
├── commands/
│   ├── record.ts                   # `api-creator record`
│   ├── generate.ts                 # `api-creator generate`
│   ├── import.ts                   # `api-creator import` (paste network data)
│   ├── test.ts                     # `api-creator test`
│   ├── list.ts                     # `api-creator list`
│   └── export.ts                   # `api-creator export`
├── recorder/
│   ├── browser-session.ts          # Playwright HAR recording
│   ├── auth-capture.ts             # Playwright auth capture flow
│   └── network-capture.ts          # Live request logging during recording
├── parser/
│   ├── har-reader.ts               # HAR parsing + filtering
│   ├── auth-detector.ts            # Detect auth patterns from traffic
│   ├── endpoint-grouper.ts         # Group requests by method+path
│   ├── type-inferrer.ts            # Infer TS types from JSON bodies
│   ├── paste-parser.ts             # Parse pasted network data
│   └── format-detector.ts          # Detect input format
├── generator/
│   ├── codegen.ts                  # Orchestrates full generate pipeline
│   ├── client-emitter.ts           # Emit TypeScript ApiClient class
│   ├── types-emitter.ts            # Emit TypeScript interfaces
│   └── cli-project-emitter.ts      # Standalone project emitter (legacy)
├── runtime/
│   ├── project-manager.ts          # CRUD for ~/.api-creator/projects/
│   ├── project-runner.ts           # Dynamic Commander.js subcommands
│   ├── http-client.ts              # Fetch wrapper with auth injection
│   └── curl-parser.ts              # Extract auth from cURL commands
└── utils/
    ├── naming.ts                   # camelCase/kebab-case, identifier sanitization
    └── url-pattern.ts              # URL normalization (IDs, hashes → params)
```

### Storage layout

```
~/.api-creator/
├── projects/
│   └── <name>/
│       ├── manifest.json           # Endpoint definitions + metadata
│       ├── client.ts               # Generated TypeScript client
│       └── types.ts                # Generated TypeScript interfaces
└── <name>.auth                     # Auth credentials (cookie, token, headers)
```

### Key types

The manifest (`ProjectManifest`) contains:
- `name`, `baseUrl`, `originalUrl`, `createdAt`, `authType`
- `endpoints[]` — each with `commandName`, `httpMethod`, `path`, `pathParams`, `queryParams`, `hasBody`, and for GraphQL: `isGraphQL`, `operationName`, `extensions`, `variables[]`

Auth (`AuthConfig`) contains:
- `cookie?` — full cookie string
- `token?` — bearer token
- `apiKey?` — API key
- `extraHeaders?` — additional headers like `x-airbnb-api-key`

### Build and test

```bash
npm run build          # tsup → dist/cli.js
npm test               # vitest (66 tests across 9 files)
node bin/api-creator.js <command>  # run locally without global install
```

## Common tasks when modifying the codebase

### Adding a new command
1. Create `src/commands/<name>.ts` exporting a `Command`
2. Import and `program.addCommand()` in `src/cli.ts`

### Changing endpoint generation logic
- URL normalization: `src/utils/url-pattern.ts`
- Endpoint grouping: `src/parser/endpoint-grouper.ts`
- Command naming: `src/utils/naming.ts`
- Manifest building: `src/generator/codegen.ts` (`buildManifestEndpoint`, `buildGraphQLManifestEndpoint`)

### Changing how CLI subcommands work
- Registration and execution: `src/runtime/project-runner.ts`
- HTTP requests: `src/runtime/http-client.ts`

### Changing auth capture
- Browser-based capture: `src/recorder/auth-capture.ts`
- cURL parsing: `src/runtime/curl-parser.ts`
- Storage: `src/runtime/project-manager.ts` (`loadAuth`, `saveAuth`, `clearAuth`)

### Filtering noise from recordings
- `src/parser/har-reader.ts` — tracking URLs, ad domains, static files are filtered here
