---
name: dev-practices
description: How to work on this project — practices, quality gates, docs maintenance, lessons learned
user-invocable: false
---

# Dev Practices

See peer ../personal-dev-practices/SKILL.md for individual work habits and practices that may be relevant or override these project-level practices.

- After changing plugin source, rebuild before testing examples

## Be aware of the context and your resources

- Check `context/` for relevant info before asking questions
- Use git for context. Be aware of your git context (branch, recent commits, etc.) when asking questions or making changes.
- Unless asked, do not guess or improvise while software engineering. Use web research or clone repos for context when needed. Seek understanding and deterministic answers based on conclusive evidence. They are within reach.

## Before commit

## Before pushing to main

- Run `npm run build` (both packages)

## Before release

- TODO: define publish checklist (npm publish not yet done)
- Test
- Ensure docs are up to date

## TDD approach

- Use your TDD skill. Or the one from https://github.com/mattpocock/skills/blob/main/tdd/SKILL.md. Do not do horizontal slicing (e.g. "I'll do all the backend tests first") — vertical slice instead (e.g. "I'll add a test for this feature, which will require some backend and frontend work, and implement both together").
- Test holistically before committing or require user to test. 
- Prefer integration tests over mocks (real gateway, real browser connection)
- This project is for agents to do frontend web development. Test by dogfooding the example apps. Unit tests may be added for critical logic that is hard to verify through the example apps, but the main testing approach should be through the gateway with the example apps.

## Docs to maintain

- `specs/` — living specs. Update when system structure changes.
- `CLAUDE.md` (root + per-package) — conventions and gotchas for agents
- `.claude/skills/` — tool usage and protocol guides

## Lessons learned

- After navigate(), may need to wait ~2-3s for browser reconnect
- eval_js runs code directly in the browser. Promises are auto-awaited. Accepts string[] for auto-waited pipelines.

## Conventions

- Conventional commits
- Mermaid diagrams over ASCII
- Progressive disclosure in skills — separate files for different depth levels, but use 3+ level TOC bridges if more than 3 levels
