# Contributing to api-creator

Thanks for your interest in contributing! Here's how to get started.

## Development setup

```bash
git clone git@github.com:CodySwannGT/api-creator.git
cd api-creator
npm install
npx playwright install chromium
npm run build
```

Run locally without a global install:

```bash
node bin/api-creator.js --help
```

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run the tests: `npm test`
4. Build to check for TypeScript errors: `npm run build`
5. Open a pull request

## Project structure

```
src/
├── cli.ts              # Entry point
├── commands/           # CLI command definitions
├── recorder/           # Playwright browser session + auth capture
├── parser/             # HAR parsing, auth detection, type inference
├── generator/          # Code generation (manifest, client, types)
├── runtime/            # Dynamic subcommands, HTTP client, auth storage
└── utils/              # Naming helpers, URL normalization
```

See `.claude/skills/manage-cli/SKILL.md` for a detailed breakdown.

## Running tests

```bash
npm test              # run all tests
npm test -- --watch   # watch mode
```

Tests are in `test/` and use Vitest. The test suite covers parsing, type inference, auth detection, endpoint grouping, naming, and code emission.

## Build

```bash
npm run build         # tsup → dist/cli.js
```

## Code style

- TypeScript with strict mode
- ESM modules (`"type": "module"` in package.json)
- Prefer simple, focused changes over large refactors

## Reporting bugs

Open an issue with:
- What you ran (command + flags)
- What you expected
- What happened instead
- Your Node.js version (`node --version`)

## Adding a new command

1. Create `src/commands/<name>.ts` exporting a `Command` instance
2. Import and register it in `src/cli.ts` with `program.addCommand()`
3. Add tests in `test/`

## Adding support for a new auth pattern

1. Update detection logic in `src/parser/auth-detector.ts`
2. Update the cURL parser in `src/runtime/curl-parser.ts`
3. Update the HTTP client in `src/runtime/http-client.ts` to inject the new auth type
4. Add tests

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
