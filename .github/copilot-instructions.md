# Copilot Instructions

GitHub Copilot auto-loads this file at session start as repository-specific
guidance. Copilot also reads `AGENTS.md` at the project root natively — that is
Lisa's **canonical, cross-agent instruction file** and the single source of
truth for this project's guidance. Prefer editing `AGENTS.md`; keep this file
for Copilot-specific notes only, to avoid duplicated guidance across the two
files Copilot loads.

Lisa governance is active in this project. Lisa's eager rules ship via the
`lisa-copilot` plugin (see
[CodySwannGT/lisa](https://github.com/CodySwannGT/lisa)) and Copilot loads them
through the plugin's bundled `rules/` directory plus the `SessionStart` hook
`inject-rules.sh` (the same polyfill Lisa uses on Claude and Codex when the
agent does not auto-load rules from a plugin).

This file is create-only from Lisa's perspective — re-running `lisa apply` will
never overwrite host-authored guidance here.

Add Copilot-specific guidance below this line:
