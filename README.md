# api-creator

Reverse-engineer any web API into a typed CLI by recording real browser traffic.

Record a live browser session, auto-generate endpoints, set up auth, and call any API endpoint directly from your terminal.

## Install

```bash
npm install -g api-creator
npx playwright install chromium
```

## Quick start

```bash
# 1. Record browser traffic (press "q" + Enter to stop)
api-creator record --url https://example.com

# 2. Generate the CLI
api-creator generate --input ./recordings/<timestamp>.har --name example

# 3. Set up auth (opens a browser — log in, then press Enter)
api-creator example auth setup

# 4. Use it
api-creator example --help
api-creator example some-endpoint --option value
```

## How it works

1. **Record** — Playwright opens a browser, you browse around, and all API traffic is captured as a HAR file
2. **Generate** — The HAR is parsed to extract endpoints, detect auth patterns, infer TypeScript types, and build a project manifest
3. **Auth** — A browser opens, you log in, and cookies + headers are captured automatically
4. **Use** — Every endpoint becomes a CLI subcommand with typed options

Generated projects are stored in `~/.api-creator/projects/<name>/` and registered as dynamic subcommands of `api-creator`.

## Commands

```bash
api-creator record --url <url>          # Record browser traffic
api-creator generate --input <har>      # Generate CLI from HAR file
api-creator list                        # List all generated projects
api-creator export <name> -o <dir>      # Export TypeScript client for programmatic use
api-creator <name> --help               # Show all endpoints for a project
api-creator <name> auth setup           # Capture auth via browser
api-creator <name> auth status          # Check auth status
api-creator <name> auth clear           # Remove stored auth
api-creator <name> <endpoint> [opts]    # Call an API endpoint
```

Run `api-creator --help` or `api-creator <command> --help` for full options.

## Auth

Auth credentials are stored at `~/.api-creator/<name>.auth` and injected into every request. Supported auth types:

- Cookies
- Bearer tokens
- API keys
- Custom headers (e.g., `x-airbnb-api-key`)

When auth expires, re-run `api-creator <name> auth setup`.

You can also set up auth from a cURL command:

```bash
api-creator <name> auth setup --file curl.txt
pbpaste | api-creator <name> auth setup --stdin
```

## GraphQL

GraphQL persisted queries are detected automatically. `operationName` and `extensions` are baked into the manifest. Only meaningful variable fields are exposed as CLI options.

```bash
api-creator airbnb mystitlequery --listing-id "abc123" --viewer-id "xyz789"
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
