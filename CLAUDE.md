## Project

SAP ATC Checker -- run SAP ABAP Test Cockpit checks with any check variant to validate code quality, Clean Core compliance, S/4HANA readiness, and ABAP Cloud readiness.

## Skills

- `skill.md` -- Claude Code skill definition for SAP ATC checks

## Scripts

| Script | Purpose |
|--------|---------|
| `run-atc-check.ts` | Single object ATC check |
| `batch-atc-parallel.ts` | Parallel batch check for packages |
| `list-check-variants.ts` | List available check variants |

Run with: `node --import tsx <script> [args]`

## Rules

- This is a test-driven project; always run `npm test` after making changes
- Do not assume anything; ask for clarification
- Ask for approval before proposing and making changes
- Never use any emoji

## Configuration

- `.env` for SAP connection environment variables (in project root)
- `.env.example` for reference template
