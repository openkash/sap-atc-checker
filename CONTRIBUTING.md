# Contributing

Contributions are welcome. This document covers the basics.

## Setup

```bash
npm install
```

## Development Workflow

1. Create a feature branch from `main`
2. Write tests first (TDD) -- see `sap-atc-client.test.ts` for patterns
3. Implement your changes
4. Run the full validation suite:
   ```bash
   npm run test:all
   ```
   This runs type-check, tests, lint, format check, and dependency audit.
5. Open a pull request

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Full suite (type-check + test + lint + format + audit)
npm run test:all
```

Tests use [Vitest](https://vitest.dev/). HTTP calls are mocked -- no SAP system is needed to run tests.

## Code Style

- TypeScript with ESLint and Prettier
- Format before committing: `npm run format`
- Lint warnings are acceptable; lint errors are not

## Security

- Never log credentials, tokens, or authorization headers -- use `SecureLogger`
- Validate all user input at system boundaries
- Encode values inserted into URLs with `encodeURIComponent`
- Escape values inserted into XML with `escapeXml`
- See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy

## Project Structure

| File | Purpose |
|------|---------|
| `sap-atc-client.ts` | Core ATC client library |
| `sap-adt-client.ts` | SAP ADT connection and object discovery |
| `secure-logger.ts` | Logging with automatic credential masking |
| `shared-utils.ts` | Shared CLI utilities (env loading, report generation) |
| `run-atc-check.ts` | CLI: single object check |
| `batch-atc-parallel.ts` | CLI: parallel batch check |
| `list-check-variants.ts` | CLI: list available check variants |
| `*.test.ts` | Test files |

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
