# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please send an email to the project maintainers with:

1. A description of the vulnerability
2. Steps to reproduce the issue
3. The potential impact
4. Any suggested fixes (optional)

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Security Design

This project connects to SAP systems using credentials. The following security measures are in place:

### Credential Safety
- Credentials are loaded from environment variables (`.env` file)
- `.env` files are excluded from version control via `.gitignore`
- A `.env.example` file with placeholder values is provided
- The `SecureLogger` automatically masks passwords, tokens, and authorization headers in all log output

### Network Security
- TLS certificate validation is enabled by default (`rejectUnauthorized: true`)
- TLS validation can be disabled for development systems with self-signed certificates via `SAP_REJECT_UNAUTHORIZED=false`
- CSRF tokens are used for all mutating SAP API calls

### Input Validation
- SAP object names are validated against a strict allowlist pattern (alphanumeric, underscores, slashes)
- XML special characters are escaped before inclusion in XML payloads to prevent XML injection
- Output file paths are validated to stay within the project directory

### Dependencies
- `package-lock.json` is committed for reproducible builds and supply chain security
- Dependencies should be regularly audited with `npm audit`

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
