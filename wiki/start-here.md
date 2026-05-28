# Start here — api-creator Wiki

## Purpose
The durable knowledge base for api-creator, a TypeScript CLI that reverse-engineers any web API into a typed command-line tool by recording real browser traffic, auto-generating endpoints, wiring up auth, and letting users call endpoints directly from the terminal. This wiki captures the project's architecture, domain concepts, design decisions, requirements, and operating playbooks so contributors and agents can answer questions about how api-creator works without re-deriving it from the source each time.

## What this is
A git-native LLM Wiki owned by **api-creator** and maintained by the `lisa-wiki` kernel. It is the
durable home for this project's knowledge (and documentation). Raw sources are preserved under
`wiki/sources/`; distilled knowledge lives in the category pages; the rules are in
`wiki/schema/llm-wiki-contract.md`.

## How to use it
- **New here?** Run `/onboard-me` (Codex: `$lisa-wiki-onboard-me`) for a guided tour + sample questions.
- **Find/answer something:** `/query "<question>"` — cited answers from the wiki.
- **Add knowledge:** `/ingest <url|file|prompt>` (Codex: `$lisa-wiki-ingest`), or `/ingest` with no
  argument for a full ingest across all enabled non-external-write sources (external-write sources
  require explicit intent).
- **Browse:** [index.md](index.md).
- **Check health:** `/lint`.

## Map
Synthesis categories: concepts, entities, architecture, requirements, decisions, playbooks, open-questions, projects, sales, marketing, finance, customers, people, legal.
Sources: `wiki/sources/` · State: `wiki/state/` · Contract:
`wiki/schema/llm-wiki-contract.md` · Log: `wiki/log.md`.
