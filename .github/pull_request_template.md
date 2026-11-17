<!--
The PR title becomes the commit on main and decides the release, so it must follow
Conventional Commits: `feat: ...` (minor), `fix: ...` (patch), `docs:`, `test:`,
`refactor:`, `chore:` (no release). Add `!` for a breaking change: `feat!: ...`.
See CONTRIBUTING.md.
-->

## What and why

<!-- What does this change, and why? Link the issue: "Closes #123". -->

## How I tested it

<!-- Commands you ran and what you checked. For changes that talk to Metabase,
say whether you tried a real instance and which version. -->

## Checklist

- [ ] `npm test`, `npm run type-check` and `npm run lint` pass
- [ ] Tests added or updated for the change
- [ ] Docs updated (`README.md`, `docs/`, `.env.example`) if behavior or configuration changed
- [ ] No credentials, real customer data or query results in code, tests or this description
- [ ] I didn't bump the version (releases are automated)
