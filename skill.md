# SAP ATC Checker

This skill performs SAP ATC (ABAP Test Cockpit) checks using any configured check variant to validate ABAP code quality, compliance, and best practices.

## What is SAP ATC?

**SAP ATC (ABAP Test Cockpit)** is SAP's central framework for static code analysis of ABAP programs. It provides:
- **Code Quality Checks**: Syntax, naming conventions, complexity metrics
- **Performance Checks**: Inefficient database access, unnecessary loops, buffering issues
- **Security Checks**: SQL injection, authorization vulnerabilities, XSS risks
- **Compliance Checks**: Clean Core, cloud readiness, deprecated feature usage
- **Custom Checks**: Organization-specific rules via custom check variants

ATC checks are run via **check variants** -- named configurations that bundle specific checks together. Different variants target different concerns.

### Common ATC Check Variants

| Variant | Purpose | Typical Use Case |
|---------|---------|------------------|
| **DEFAULT** | System default checks | General code quality gate |
| **CLEAN_CORE** | Clean Core compliance -- "Usage of APIs" check | Ensuring extensibility compliance |
| **ABAP_CLOUD_DEVELOPMENT_DEFAULT** | ABAP Cloud Readiness -- "Usage of Released APIs" check | Cloud migration checks |
| **S4HANA_READINESS** | S/4HANA migration readiness | Pre-migration assessment |
| **ZABAP_CLOUD_DEVELOPMENT** | ABAP Cloud development (Z-variant) | System-specific cloud checks |
| *(Custom)* | Organization-specific rules | Internal standards enforcement |

**Note:** Available variants depend on your SAP system configuration. Run `node --import tsx list-check-variants.ts` to discover what is available on your system. The variants above are from SAP documentation and live-verified systems; your system may have different or additional variants.

**Cloud Readiness vs Clean Core:** The Cloud Readiness check ("Usage of Released APIs") and Clean Core check ("Usage of APIs") are related but distinct check categories. SAP provides a migration tool (`zatc_cloud_rdnss_2_cln_core`, SAP_BASIS 7.58+) to migrate exemptions from Cloud Readiness to Clean Core checks. See [SAP/abap-atc-cr-cv-s4hc-tools](https://github.com/SAP/abap-atc-cr-cv-s4hc-tools) for details.

### ATC Priority Levels

ATC findings are classified by priority (severity). Priority 1 and 2 can both block transport release depending on system configuration.

| Priority | SAP Severity | Description | Action |
|----------|-------------|-------------|--------|
| **1** | **Very High** (Blocker) | Critical issue, blocks transport | Must fix before transport |
| **2** | **High** (Error) | Significant issue, may block transport | Fix before transport |
| **3** | **Medium** (Warning) | Non-critical, triggers notifications | Review and plan remediation |
| **4** | **Low** (Information) | Minor suggestion, informational | Optional improvement |

### ATC Check Workflow (ADT API)

The ATC check follows a 5-step workflow via the SAP ADT (ABAP Development Tools) REST API:

1. **Create Worklist** - POST to `/sap/bc/adt/atc/worklists?checkVariant=<VARIANT>`
2. **Start Run** - POST to `/sap/bc/adt/atc/runs?worklistId=<ID>` with object references
3. **Poll Status** - GET `/sap/bc/adt/atc/runs/<runId>` until finished
4. **Get Results** - GET `/sap/bc/adt/atc/worklists/<ID>` for findings
5. **Get Documentation** - GET `/sap/bc/adt/documentation/atc/documents/...` per finding

### Supported Object Types

| Type Code | Object Type | ADT URL Path |
|-----------|-------------|--------------|
| CLAS, CLAS/OC, CLAS/I | Class | `oo/classes` |
| INTF, INTF/OI | Interface | `oo/interfaces` |
| PROG/P | Program | `programs/programs` |
| PROG/I | Include | `programs/includes` |
| FUGR, FUGR/F | Function Group | `functions/groups` |
| FUNC | Function Module | `functions/functions` |
| DDLS, DDLS/DL | CDS View | `ddic/ddl/sources` |
| BDEF, BDEF/BD | Behavior Definition | `bo/behaviordefinitions` |
| SRVD | Service Definition | `ddic/srvd/sources` |
| SRVB | Service Binding | `businessservices/bindings` |
| TABL, TABL/DT | Table | `ddic/tables` |
| STRU | Structure | `ddic/structures` |
| DTEL | Data Element | `ddic/dataelements` |

## When to Use This Skill

Use this skill when you need to:
- Run ATC checks with any check variant (not just Clean Core)
- Validate ABAP code quality before transport
- Audit custom code against specific check categories
- Discover available check variants on an SAP system
- Batch-check entire packages for code quality
- Generate code quality reports for review

**For Clean Core-specific checks**, the CLEAN_CORE variant provides Clean Core compliance checking. See the Workflows section in README.md for recommended assessment sequences.

## How This Skill Works

1. **Reads SAP connection details** from a `.env` file (searches project root)
2. **Auto-detects object type** by querying the SAP system
3. **Resolves check variant** -- uses specified variant, discovers system default, or falls back to DEFAULT
4. **Executes ATC check** via SAP ADT API
5. **Retrieves detailed documentation** for each finding
6. **Formats results** with priority levels, line numbers, and actionable recommendations

## Available Scripts

### 1. Single Object Check: `run-atc-check.ts`

```bash
# With default variant
node --import tsx run-atc-check.ts ZCL_MY_CLASS

# With specific variant
node --import tsx run-atc-check.ts ZCL_MY_CLASS --variant S4HANA_READINESS

# Display only (no file save)
node --import tsx run-atc-check.ts ZCL_MY_CLASS --variant ABAP_CLOUD_DEVELOPMENT --no-save
```

**Options:**
- `--variant, -V NAME` - Check variant (default: system default)
- `--output, -o FILE` - Custom output file path
- `--no-save` - Do not save report
- `--env PATH` - Path to .env file
- `--help, -h` - Show help

### 2. List Check Variants: `list-check-variants.ts`

```bash
# Display available variants
node --import tsx list-check-variants.ts

# Output as JSON
node --import tsx list-check-variants.ts --json

# Use custom .env file
node --import tsx list-check-variants.ts --env /path/to/.env
```

**Options:**
- `--json` - Output as JSON
- `--env PATH` - Path to .env file
- `--help, -h` - Show help

### 3. Batch Parallel Check: `batch-atc-parallel.ts`

```bash
# Check package with default variant
node --import tsx batch-atc-parallel.ts ZPACKAGE

# Check with specific variant and concurrency
node --import tsx batch-atc-parallel.ts ZPACKAGE --variant S4HANA_READINESS --concurrency 5

# Check from file
node --import tsx batch-atc-parallel.ts objects.txt --variant ABAP_CLOUD_DEVELOPMENT --max 50

# Initialize progress tracking for large packages
node --import tsx batch-atc-parallel.ts ZPACKAGE --init-progress --variant CLEAN_CORE
```

**Options:**
- `--variant, -V NAME` - Check variant (default: system default)
- `--concurrency N` - Parallel checks (default: auto, range: 3-10)
- `--max N` - Maximum objects to process
- `--init-progress` - Initialize progress tracking
- `--with-docs` - Include detailed documentation (slower)
- `--env PATH` - Path to .env file
- `--help, -h` - Show help

## Prerequisites

- Node.js >= 20 and npm installed
- `tsx` package (will be installed if needed)
- Network access to SAP system
- SAP user with ATC execution authorization:
  - `S_RFC` for ADT API access
  - `S_DEVELOP` (activities 03, 16) for code analysis
  - `S_Q_GOVERN` (activity 31, `ATC_OTYPGO` 01) -- only needed for exemption approval
- A `.env` file with SAP connection details

## Environment File Format

Create a `.env` file in your project root with:

```env
# Required
SAP_HOST=your-sap-host.com
SAP_CLIENT=100
SAP_USERNAME=YOUR_USERNAME
SAP_PASSWORD=YOUR_PASSWORD

# Optional
SAP_SID=ABC
SAP_INSTANCE_NUMBER=00
SAP_LANGUAGE=EN
SAP_SECURE=true
```

## Skill Invocation Instructions

When the user invokes this skill, follow these steps:

### Step 1: Check for .env File

Check if a `.env` file exists in the project root:

```bash
ls -la .env
```

- **If found**: Proceed to Step 2
- **If not found**: Ask the user for the path to their `.env` file

### Step 2: Get Object Name and Variant

Ask the user:

- "Which ABAP object would you like to check?"
- "Which ATC check variant? (leave blank for system default, or specify e.g., CLEAN_CORE, S4HANA_READINESS, ABAP_CLOUD_DEVELOPMENT_DEFAULT)"

### Step 3: Install Dependencies (if needed)

```bash
npm install
```

### Step 4: Execute the ATC Check

```bash
node --import tsx run-atc-check.ts <OBJECT_NAME> --variant <VARIANT>
```

Or without variant (uses system default):
```bash
node --import tsx run-atc-check.ts <OBJECT_NAME>
```

### Step 5: Interpret Results

The script outputs:
1. **Connection Status**: SAP system connection progress
2. **Variant Resolution**: Which check variant is being used
3. **Object Discovery**: Object type detection
4. **ATC Execution Progress**: 5-step workflow with status
5. **Summary**: Count of errors, warnings, and info messages
6. **Detailed Findings**: Each finding with priority, line number, check ID, quickfix availability

### Step 6: Present Results to User

**If No Findings:**
```
ATC Check Passed!

The object <OBJECT_NAME> has no findings with variant <VARIANT>.
```

**If Findings Exist:**
```
ATC Check Results for <OBJECT_NAME> (Variant: <VARIANT>)

Summary:
- Errors: X
- Warnings: Y
- Info: Z

Errors:
1. [Description]
   - Line: X
   - Check ID: Y
   - Priority: 1 - Very High (Blocker)
   - Quickfix: automatic/manual/none

[Continue for all findings...]

Next Steps:
- Address all errors before transport
- Review warnings for remediation planning
- Consider info findings for best practices
```

## Troubleshooting

**Connection Failures:**
- Verify `.env` file credentials
- Check network access to SAP system
- Ensure user has ATC authorization (`S_RFC`, `S_DEVELOP` activities 03/16)

**Object Not Found:**
- Verify object name spelling (case-insensitive)
- Ensure object exists in the target SAP client

**Variant Not Found:**
- Run `list-check-variants.ts` to see available variants
- Check with SAP Basis team for variant configuration
- Fall back to DEFAULT variant

**No CSRF Token:**
- SAP system may not support ADT services
- Check SAP system version (requires NetWeaver 7.5+)

---

**This skill is self-contained** -- all SAP ADT API calls are made directly by the TypeScript scripts. No MCP server required.
