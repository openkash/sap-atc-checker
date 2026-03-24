[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet.svg)](https://claude.com/claude-code)

# SAP ATC Checker Skill

Run ATC checks with any check variant to validate ABAP code quality and generate assessment reports.

## Quick Start

```bash
# Check with system default variant
node --import tsx run-atc-check.ts ZCL_MY_CLASS

# Check with specific variant
node --import tsx run-atc-check.ts ZCL_MY_CLASS --variant S4HANA_READINESS

# List available check variants
node --import tsx list-check-variants.ts

# Custom output path
node --import tsx run-atc-check.ts ZCL_MY_CLASS --output ./my-report.md

# Display only (no save)
node --import tsx run-atc-check.ts ZCL_MY_CLASS --no-save
```

## Environment Setup

Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
# Then edit .env with your SAP connection details
```

See `.env.example` for all available configuration options including TLS settings and logging.

## Features

- **Any check variant** -- DEFAULT, CLEAN_CORE ("Usage of APIs"), ABAP_CLOUD_DEVELOPMENT_DEFAULT ("Usage of Released APIs"), S4HANA_READINESS, custom, etc.
- **Variant discovery** -- queries SAP system for available variants
- **Auto-saves reports by default** to `reports/atc/` directory
- Auto-detects object types
- Shows detailed findings with line numbers
- Shows quickfix availability
- Exit code 1 if errors found

## Workflows

### Develop, Check, Fix

Run ATC checks during development. Findings at priority 1-2 block transport in most SAP configurations -- catching them early saves a round trip.

```bash
# After writing or modifying ABAP code:
node --import tsx run-atc-check.ts ZCL_MY_CLASS

# Fix the reported findings, then verify:
node --import tsx run-atc-check.ts ZCL_MY_CLASS
```

### Clean Core Compliance

Assess custom code against SAP Clean Core guidelines. The CLEAN_CORE variant flags usage of non-released APIs that need replacement or wrapping.

```bash
# Single object
node --import tsx run-atc-check.ts ZCL_MY_CLASS --variant CLEAN_CORE

# Entire package -- generates a prioritized summary
node --import tsx batch-atc-parallel.ts ZPACKAGE --variant CLEAN_CORE
# Then review: reports/atc/atc_summary.md
```

### S/4HANA Migration Readiness

Scan custom code for S/4HANA compatibility issues before migration. Batch mode gives a full picture across a package.

```bash
node --import tsx batch-atc-parallel.ts ZPACKAGE --variant S4HANA_READINESS
# Then review: reports/atc/atc_summary.md
```

### ABAP Cloud Readiness

Verify that custom code uses only released APIs -- required for ABAP Cloud (public cloud, BTP ABAP Environment).

```bash
node --import tsx run-atc-check.ts ZCL_MY_CLASS --variant ABAP_CLOUD_DEVELOPMENT_DEFAULT
```

### Quality Gate

The checker exits with code 1 when errors are found. Use this in scripts or CI pipelines to block transport of non-compliant code.

```bash
node --import tsx run-atc-check.ts ZCL_MY_CLASS --variant CLEAN_CORE \
  || echo "Blocked: ATC errors must be resolved before transport"
```

### Suggested Assessment Order

For a full Clean Core evaluation of an existing codebase:

1. **Discover** -- identify custom objects in the target package
2. **Scan** -- batch check with `CLEAN_CORE` variant
3. **Triage** -- review `atc_summary.md`, sort by priority
4. **Fix** -- address priority 1 (blocker) and 2 (error) findings first
5. **Verify** -- re-run checks on fixed objects to confirm resolution
6. **Repeat** -- work through priority 3 (warning) findings

The same sequence applies to `S4HANA_READINESS` and `ABAP_CLOUD_DEVELOPMENT_DEFAULT` assessments.

## Using with Claude Code

This skill is designed to work with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Rather than running scripts manually, you describe what you need and Claude Code handles the rest -- running checks, reading reports, interpreting findings, and suggesting fixes.

### Example prompts

**Run a check:**
```
Run a Clean Core check on ZCL_MY_CLASS
```

**Assess a package:**
```
Check all objects in package ZTEST for S/4HANA readiness and summarize the findings
```

**Check and fix (the full loop):**
```
Run ATC check on ZCL_MY_CLASS with CLEAN_CORE variant, read the source code,
and suggest fixes for any findings
```

**Discover what's available:**
```
What ATC check variants are available on our SAP system?
```

**Triage an existing report:**
```
Read reports/atc/atc_summary.md and tell me which objects need attention first
```

### What Claude Code brings to ATC checks

The scripts in this skill run checks and produce reports. Claude Code closes the loop:

1. **Runs the check** -- picks the right script, variant, and options
2. **Interprets findings** -- explains what each finding means in context, not just the message text
3. **Reads ABAP source** -- pulls the relevant code from SAP to understand the root cause
4. **Suggests fixes** -- proposes concrete ABAP code changes based on the findings and source
5. **Verifies** -- re-runs the check after changes to confirm findings are resolved

This turns a multi-step manual process into a single conversation.

### Setup

1. **Install Claude Code** (if not already installed):
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. **Clone and configure:**
   ```bash
   git clone https://github.com/openkash/sap-atc-checker.git
   cd sap-atc-checker
   cp .env.example .env
   # Edit .env with your SAP connection details
   npm install
   ```

3. **Launch Claude Code:**
   ```bash
   claude
   ```

Claude Code reads `CLAUDE.md` at the project root and `skill.md` in the skill directory automatically -- no additional configuration needed.

## ATC Priority Levels

| Priority | SAP Severity | Description |
|----------|-------------|-------------|
| **1** | Very High (Blocker) | Must fix, blocks transport |
| **2** | High (Error) | Fix before transport |
| **3** | Medium (Warning) | Review and plan remediation |
| **4** | Low (Information) | Optional improvement |

## Scripts

| Script | Purpose |
|--------|---------|
| `run-atc-check.ts` | Single object ATC check |
| `list-check-variants.ts` | List available check variants |
| `batch-atc-parallel.ts` | Parallel batch check for packages |

## Object Types

CLAS, INTF, PROG, FUGR, FUNC, DDLS, BDEF, SRVD, SRVB, TABL, STRU, DTEL, and more.

## Project Structure

```
sap-atc-checker/
├── .env.example              # SAP connection template (copy to .env)
├── .github/workflows/ci.yml  # GitHub Actions CI pipeline
├── .gitignore                # Excludes .env, logs, node_modules
├── .eslintrc.json            # Linting rules
├── .prettierrc               # Code formatting rules
├── package.json              # Dependencies and npm scripts
├── package-lock.json         # Locked dependency versions
├── tsconfig.json             # TypeScript configuration
├── LICENSE                   # Apache-2.0
├── README.md                 # This file
├── CLAUDE.md                 # Claude Code project instructions
├── SECURITY.md               # Vulnerability reporting policy
├── CONTRIBUTING.md           # Contribution guidelines
├── skill.md                  # Claude Code skill definition
├── run-atc-check.ts          # CLI: single object ATC check
├── batch-atc-parallel.ts     # CLI: parallel batch check for packages
├── list-check-variants.ts    # CLI: list available check variants
├── sap-atc-client.ts         # ATC client (worklist, run, findings)
├── sap-adt-client.ts         # ADT client (connection, object discovery)
├── shared-utils.ts           # Env loading, report saving, summary
├── secure-logger.ts          # Logging with sensitive data masking
├── sap-atc-client.test.ts    # ATC client unit tests
├── secure-logger.test.ts     # SecureLogger masking tests
└── reports/atc/              # Generated reports (git-ignored)
    ├── <OBJECT>_atc.md       # Individual check reports
    └── atc_summary.md        # Aggregated summary
```

## Output Files

Reports are saved to `reports/atc/`:

- `<OBJECT_NAME>_atc.md` -- ATC check results with findings
- `atc_summary.md` -- Summary of all checked objects

**Override:** Use `--output FILE` for custom path or `--no-save` for display only.

## Batch Mode

```bash
# Check entire package
node --import tsx batch-atc-parallel.ts ZPACKAGE --variant ABAP_CLOUD_DEVELOPMENT

# With concurrency control
node --import tsx batch-atc-parallel.ts ZPACKAGE --variant S4HANA_READINESS --concurrency 5
```

## Exit Codes

- `0` - Success (no errors)
- `1` - Errors found or execution failure

## Troubleshooting

**Connection Failed:** Check `.env` configuration and SAP user authorization (`S_RFC`, `S_DEVELOP` activities 03/16)
**Object Not Found:** Verify object name and client
**Variant Not Found:** Run `list-check-variants.ts` to see available variants
**Timeout:** Check SAP system performance

## Security

### Credential Management
- All SAP credentials loaded from `.env` file -- never hardcoded in source
- `.gitignore` excludes `.env`, `.env.*`, and all log files from version control
- `.env.example` provided with placeholder values for safe reference
- Required environment variables validated before any SAP connection attempt
- Connection objects passed in-memory only; credentials never written to disk

### Secure Logging (SecureLogger)
The `SecureLogger` module automatically redacts sensitive data in all console and file output:
- **Password masking** -- fields containing `password`, `passwd`, `pwd` replaced with `***REDACTED***`
- **Auth header masking** -- `authorization`, `auth`, `token` fields fully redacted
- **Username partial masking** -- only first 2 characters shown (e.g., `AD***`)
- **File path sanitization** -- home directory paths (`/home/user`, `C:\Users\user`) masked
- **Error message sanitization** -- credential patterns (`password=`, `token=`, `authorization=`) stripped from exception messages and stack traces
- **Recursive masking** -- nested objects and arrays processed at all depths
- **Test coverage** -- unit tests verify masking behavior (`secure-logger.test.ts`)

### Input Validation and Injection Prevention
- **Object name validation** -- strict allowlist pattern (alphanumeric, underscores, slashes, max 40 characters) via `validateObjectName()` prevents command/path injection
- **XML escaping** -- `escapeXml()` encodes `&`, `<`, `>`, `"`, `'` in all user-supplied values before XML payload construction, preventing XML injection
- **URL encoding** -- variant names, worklist IDs, run IDs, and search queries passed through `encodeURIComponent` before inclusion in URLs
- **Path traversal prevention** -- output file paths validated to stay within the project directory
- **SAP SID format validation** -- 3 alphanumeric characters

### Session Security
- CSRF tokens fetched on initial SAP connection (`x-csrf-token: fetch`) and included in all state-changing POST requests
- Cookie-based session management with proper `set-cookie` parsing
- Stateful ADT sessions (`x-sap-adt-sessiontype: stateful`)

### Network Security
- **TLS certificate validation enabled by default** (`rejectUnauthorized: true`) -- can be disabled for development systems with self-signed certificates via `SAP_REJECT_UNAUTHORIZED=false`
- Configurable HTTP/HTTPS via `SAP_SECURE` environment variable
- 60-second request timeout on all HTTP calls
- Authentication failure (401) reported immediately without retry to prevent credential lockout

### Data Handling
- All reports stored locally only -- no external transmission
- Reports written to configurable `REPORTS_DIR` directory
- Log files written to configurable `LOGS_DIR` directory
- Both `logs/` and `reports/` are git-ignored by default

### Dependency Security
- `package-lock.json` committed for reproducible builds and supply chain integrity
- Run `npm audit` regularly to check for known vulnerabilities

### Reporting Vulnerabilities

See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy.

## License

Apache-2.0. See [LICENSE](LICENSE) for the full text.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.


