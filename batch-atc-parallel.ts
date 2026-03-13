#!/usr/bin/env node
/**
 * SAP ATC Batch Check - Parallel Processing
 *
 * Runs ATC checks on multiple objects in parallel for maximum performance.
 * Uses shared SAP connection and native async/await with Promise.all().
 * Supports any ATC check variant.
 *
 * Usage:
 *   node --import tsx batch-atc-parallel.ts <packageName|objectList.txt> [options]
 *
 * @version 1.0.0 - General-purpose ATC checker (variant-agnostic)
 */

import { SAPConnection, SAPADTClient } from './sap-adt-client.js';
import { SAPATCClient, ATCCheckResult, getSAPSID, validateObjectName } from './sap-atc-client.js';
import { loadEnvFileOnly, loadEnvFile, saveReportToFile, updateSummaryFile } from './shared-utils.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { SecureLogger } from './secure-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ENV_PATH = loadEnvFileOnly(__dirname);

const logsDir = process.env.LOGS_DIR || 'logs';
SecureLogger.configure({
  logToFile: process.env.LOG_TO_FILE === 'true',
  logDir: resolve(__dirname, logsDir),
  verbose: false,
  quiet: false
});

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface BatchATCOptions {
  packageName?: string;
  objectListFile?: string;
  concurrency?: number;
  skipDiscovery?: boolean;
  maxObjects?: number;
  envFilePath?: string;
  includeDocumentation?: boolean;
  verbose?: boolean;
  initProgress?: boolean;
  variant?: string;
}

interface ProgressObjectEntry {
  name: string;
  type: string;
  description?: string;
  status: 'pending' | 'checked' | 'failed';
  reportFile?: string;
  overallPriority?: number;
  error?: string;
}

interface ProgressData {
  skill: 'atc-check';
  package: string;
  variant: string;
  started: string;
  lastUpdated: string;
  totalObjects: number;
  checked: number;
  failed: number;
  systemInfo: {
    sid: string;
    host: string;
    client: string;
  };
  objects: ProgressObjectEntry[];
}

interface BatchSummary {
  total: number;
  successful: number;
  failed: number;
  totalErrors: number;
  totalWarnings: number;
  totalInfo: number;
  totalDuration: number;
  results: ATCCheckResult[];
}

// ============================================================================
// PACKAGE DISCOVERY (Integrated)
// ============================================================================

async function getPackageObjects(packageName: string, connection: SAPConnection): Promise<string[]> {
  SecureLogger.info(`\nDiscovering objects in package ${packageName}...`);

  const adtClient = new SAPADTClient(connection);
  const connected = await adtClient.connect();

  if (!connected) {
    throw new Error('Failed to connect to SAP for package discovery');
  }

  const objects = await adtClient.getObjects(packageName);

  // Filter for custom objects (Z*/Y*)
  const customObjects = objects.filter(
    obj =>
      obj.name.match(/^[ZY]/i) &&
      (obj.type.startsWith('CLAS') ||
        obj.type.startsWith('PROG') ||
        obj.type.startsWith('FUGR') ||
        obj.type.startsWith('DDLS'))
  );

  SecureLogger.info(`Found ${customObjects.length} custom objects in package ${packageName}\n`);

  return customObjects.map(obj => obj.name);
}

// ============================================================================
// CONCURRENCY CONTROL
// ============================================================================

function determineConcurrency(objectCount: number, requested?: number): number {
  if (requested) return requested;

  if (objectCount <= 10) return 3;
  if (objectCount <= 50) return 5;
  if (objectCount <= 200) return 7;
  return 10;
}

// ============================================================================
// PARALLEL BATCH PROCESSING
// ============================================================================

async function runParallelBatchATC(
  objects: string[],
  client: SAPATCClient,
  concurrency: number,
  variant: string,
  includeDocumentation: boolean = false,
  outputDir: string
): Promise<ATCCheckResult[]> {
  const results: ATCCheckResult[] = [];
  let completed = 0;

  SecureLogger.info(`\nProcessing ${objects.length} objects with concurrency ${concurrency}...`);
  SecureLogger.info(`Variant: ${variant}`);
  SecureLogger.info(`Documentation: ${includeDocumentation ? 'Included (slower)' : 'Skipped (faster)'}\n`);

  for (let i = 0; i < objects.length; i += concurrency) {
    const batch = objects.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async objectName => {
        try {
          const result = await client.checkObject({
            objectName,
            variant,
            includeDocumentation
          });

          completed++;

          const progress = `[${completed}/${objects.length}]`;
          const status =
            result.status === 'success'
              ? `${result.summary.errors} errors, ${result.summary.warnings} warnings`
              : `FAILED: ${result.errorMessage}`;

          SecureLogger.info(`${progress} ${objectName.padEnd(30)} - ${status}`);

          if (result.status === 'success') {
            const reportFile = path.join(outputDir, `${objectName}_atc.md`);
            await saveReportToFile(
              objectName,
              result.objectType,
              result.findings,
              variant,
              reportFile,
              result.systemInfo
            );

            await updateSummaryFile(
              objectName,
              result.objectType,
              result.overallPriority,
              result.summary.total,
              variant,
              outputDir
            );
          }

          return result;
        } catch (error: any) {
          completed++;
          SecureLogger.info(`[${completed}/${objects.length}] ${objectName.padEnd(30)} - ERROR: ${error.message}`);

          return {
            objectName,
            objectType: 'UNKNOWN',
            variant,
            findings: [],
            summary: { total: 0, errors: 0, warnings: 0, info: 0 },
            overallPriority: 0,
            overallPriorityText: 'No Findings',
            systemInfo: {
              sid: getSAPSID(),
              host: '',
              client: '',
              checkDate: new Date().toISOString()
            },
            duration: 0,
            status: 'failed' as const,
            errorMessage: error.message
          };
        }
      })
    );

    results.push(...batchResults);
  }

  return results;
}

// ============================================================================
// SUMMARY REPORT
// ============================================================================

function printBatchSummary(summary: BatchSummary): void {
  SecureLogger.info('\n' + '='.repeat(80));
  SecureLogger.info('BATCH ATC CHECK SUMMARY');
  SecureLogger.info('='.repeat(80));

  SecureLogger.info(`\nExecution Summary:`);
  SecureLogger.info(`   Total Objects: ${summary.total}`);
  SecureLogger.info(`   Successfully Checked: ${summary.successful}`);
  SecureLogger.info(`   Failed: ${summary.failed}`);
  SecureLogger.info(`   Total Time: ${(summary.totalDuration / 1000).toFixed(1)}s`);

  if (summary.successful > 0) {
    SecureLogger.info(`\nFindings Summary:`);
    SecureLogger.info(`   Total Errors: ${summary.totalErrors}`);
    SecureLogger.info(`   Total Warnings: ${summary.totalWarnings}`);
    SecureLogger.info(`   Total Info: ${summary.totalInfo}`);

    const clean = summary.results.filter(r => r.status === 'success' && r.summary.total === 0);
    SecureLogger.info(`\nClean Objects: ${clean.length}/${summary.successful}`);

    const withErrors = summary.results.filter(r => r.status === 'success' && r.summary.errors > 0);
    if (withErrors.length > 0) {
      SecureLogger.info(`\nObjects with Errors (${withErrors.length}):`);
      withErrors
        .sort((a, b) => b.summary.errors - a.summary.errors)
        .slice(0, 10)
        .forEach(r => {
          SecureLogger.info(
            `   ${r.objectName.padEnd(30)} - ${r.summary.errors} errors, ${r.summary.warnings} warnings`
          );
        });
      if (withErrors.length > 10) {
        SecureLogger.info(`   ... and ${withErrors.length - 10} more`);
      }
    }

    const withWarnings = summary.results.filter(
      r => r.status === 'success' && r.summary.errors === 0 && r.summary.warnings > 0
    );
    if (withWarnings.length > 0) {
      SecureLogger.info(`\nObjects with Warnings Only (${withWarnings.length}):`);
      withWarnings
        .sort((a, b) => b.summary.warnings - a.summary.warnings)
        .slice(0, 10)
        .forEach(r => {
          SecureLogger.info(`   ${r.objectName.padEnd(30)} - ${r.summary.warnings} warnings`);
        });
      if (withWarnings.length > 10) {
        SecureLogger.info(`   ... and ${withWarnings.length - 10} more`);
      }
    }
  }

  SecureLogger.info('\n' + '='.repeat(80) + '\n');
}

function generateBatchSummary(results: ATCCheckResult[], totalDuration: number): BatchSummary {
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'failed');

  return {
    total: results.length,
    successful: successful.length,
    failed: failed.length,
    totalErrors: successful.reduce((sum, r) => sum + r.summary.errors, 0),
    totalWarnings: successful.reduce((sum, r) => sum + r.summary.warnings, 0),
    totalInfo: successful.reduce((sum, r) => sum + r.summary.info, 0),
    totalDuration,
    results
  };
}

// ============================================================================
// PROGRESS INITIALIZATION (for resumable workflows)
// ============================================================================

async function initializeProgress(
  packageName: string,
  connection: SAPConnection,
  variant: string,
  maxObjects?: number
): Promise<ProgressData> {
  SecureLogger.info('\n' + '='.repeat(80));
  SecureLogger.info('    SAP ATC Check - Initialize Progress Tracking');
  SecureLogger.info('='.repeat(80) + '\n');

  SecureLogger.info(`Package: ${packageName}`);
  SecureLogger.info(`Variant: ${variant}`);
  SecureLogger.info(`Mode: Initialize progress (no ATC checks)\n`);

  const objects = await getPackageObjects(packageName, connection);

  let objectsToProcess = objects;
  if (maxObjects && objects.length > maxObjects) {
    objectsToProcess = objects.slice(0, maxObjects);
    SecureLogger.info(`Limited to ${maxObjects} objects\n`);
  }

  const now = new Date().toISOString();
  const progressData: ProgressData = {
    skill: 'atc-check',
    package: packageName,
    variant,
    started: now,
    lastUpdated: now,
    totalObjects: objectsToProcess.length,
    checked: 0,
    failed: 0,
    systemInfo: {
      sid: getSAPSID(),
      host: connection.host,
      client: connection.client
    },
    objects: objectsToProcess.map(name => ({
      name,
      type: 'UNKNOWN',
      status: 'pending' as const
    }))
  };

  const reportsDir = process.env.REPORTS_DIR || 'reports';
  const outputDir = path.resolve(__dirname, reportsDir, 'atc', packageName);
  fs.mkdirSync(outputDir, { recursive: true });

  const progressPath = path.join(outputDir, 'progress.json');
  fs.writeFileSync(progressPath, JSON.stringify(progressData, null, 2));

  SecureLogger.info('='.repeat(80));
  SecureLogger.info('   Progress tracking initialized!');
  SecureLogger.info('='.repeat(80));
  SecureLogger.info(`   - Objects to check: ${progressData.totalObjects}`);
  SecureLogger.info(`   - Variant: ${variant}`);
  SecureLogger.info(`   - Progress file: ${progressPath}`);
  SecureLogger.info('='.repeat(80) + '\n');

  return progressData;
}

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

function parseArgs(): BatchATCOptions {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    displayHelp();
    process.exit(0);
  }

  const input = args[0];
  const options: BatchATCOptions = {};

  if (fs.existsSync(input)) {
    options.objectListFile = input;
  } else {
    options.packageName = input;
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--concurrency' && args[i + 1]) {
      options.concurrency = parseInt(args[i + 1]);
      i++;
    } else if (arg === '--max' && args[i + 1]) {
      options.maxObjects = parseInt(args[i + 1]);
      i++;
    } else if (arg === '--skip-discovery') {
      options.skipDiscovery = true;
    } else if (arg === '--env' && args[i + 1]) {
      options.envFilePath = args[i + 1];
      i++;
    } else if (arg === '--with-docs') {
      options.includeDocumentation = true;
    } else if (arg === '--init-progress') {
      options.initProgress = true;
    } else if ((arg === '--variant' || arg === '-V') && args[i + 1]) {
      options.variant = args[i + 1];
      i++;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    }
  }

  return options;
}

function displayHelp(): void {
  SecureLogger.info(`
SAP ATC Batch Check - Parallel Processing

Runs ATC checks on multiple objects in parallel for maximum performance.
Supports any ATC check variant configured on the SAP system.

USAGE:
  node --import tsx batch-atc-parallel.ts <PACKAGE_NAME|FILE> [OPTIONS]

ARGUMENTS:
  PACKAGE_NAME         SAP package name (e.g., ZTEST, $TMP)
  FILE                 Text file with object names (one per line)

OPTIONS:
  --variant, -V NAME   ATC check variant (default: system default)
  --concurrency N      Number of parallel checks (default: auto, range: 3-10)
  --max N              Maximum number of objects to process
  --init-progress      Initialize progress tracking for resumable workflows
  --with-docs          Include detailed documentation for findings (slower)
  --verbose, -v        Show detailed findings in console output
  --skip-discovery     Skip package discovery (only for file input)
  --env PATH           Path to .env file
  --help, -h           Show this help message

EXAMPLES:
  # Check all objects in package ZTEST with default variant
  node --import tsx batch-atc-parallel.ts ZTEST

  # Check with specific variant and concurrency
  node --import tsx batch-atc-parallel.ts ZTEST --variant CLEAN_CORE --concurrency 5

  # Check from file with a performance variant
  node --import tsx batch-atc-parallel.ts objects.txt --variant S4HANA_READINESS

  # Check max 50 objects from package
  node --import tsx batch-atc-parallel.ts $TMP --max 50

  # List available variants first
  node --import tsx list-check-variants.ts

CONCURRENCY GUIDELINES:
  - Default (auto): 3-10 based on object count
  - Conservative (production): 3-5
  - Balanced (dev): 5-7
  - Aggressive (testing): 10

OUTPUT:
  - Individual markdown reports for each object (reports/atc/)
  - Updated summary file (reports/atc/atc_summary.md)
  - Real-time progress and console summary

REQUIREMENTS:
  - .env file with SAP connection details
  - SAP_HOST, SAP_CLIENT, SAP_USERNAME, SAP_PASSWORD
`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  SecureLogger.info('\nSAP ATC Checker - Parallel Batch Processing\n');

  const options = parseArgs();

  const connection = loadEnvFile(options.envFilePath, ENV_PATH);
  if (!connection) {
    SecureLogger.error('\nNo .env file found.');
    SecureLogger.error('Please provide .env file with SAP connection details.\n');
    process.exit(1);
  }

  // Resolve variant
  let variant = options.variant;
  if (!variant) {
    // Try to discover default variant
    const tempClient = new SAPATCClient(connection);
    const tempConnected = await tempClient.connect();
    if (tempConnected) {
      const variants = await tempClient.listCheckVariants();
      const defaultVariant = variants.find(v => v.isDefault);
      if (defaultVariant) {
        variant = defaultVariant.name;
        SecureLogger.info(`Using default variant: ${variant}`);
      } else if (variants.length > 0) {
        variant = variants[0].name;
        SecureLogger.info(`Using first available variant: ${variant}`);
      }
    }
    if (!variant) {
      variant = 'DEFAULT';
      SecureLogger.info(`No variants discovered, using: ${variant}`);
    }
  }

  // Handle --init-progress mode
  if (options.initProgress) {
    if (!options.packageName) {
      SecureLogger.error('--init-progress requires a package name, not a file');
      process.exit(1);
    }
    try {
      const progressData = await initializeProgress(options.packageName, connection, variant, options.maxObjects);
      SecureLogger.info(JSON.stringify(progressData, null, 2));
      process.exit(0);
    } catch (error) {
      SecureLogger.error(`\nError initializing progress: ${error}\n`);
      process.exit(1);
    }
  }

  // Create ATC client (shared for all checks)
  const atcClient = new SAPATCClient(connection);
  SecureLogger.info('\nConnecting to SAP...');
  const connected = await atcClient.connect();

  if (!connected) {
    SecureLogger.error('Failed to connect to SAP system');
    process.exit(1);
  }

  // Get object list
  let objects: string[] = [];

  if (options.objectListFile) {
    SecureLogger.info(`\nReading objects from file: ${options.objectListFile}`);
    const content = fs.readFileSync(options.objectListFile, 'utf-8');
    objects = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .filter(line => line.match(/^[ZY]/i));

    // Validate all object names
    const invalidObjects = objects.filter(name => !validateObjectName(name));
    if (invalidObjects.length > 0) {
      SecureLogger.error(`Invalid object names found: ${invalidObjects.join(', ')}`);
      SecureLogger.error('   Object names must be alphanumeric with underscores and slashes, max 40 characters.');
      process.exit(1);
    }

    SecureLogger.info(`Found ${objects.length} custom objects in file`);
  } else if (options.packageName) {
    objects = await getPackageObjects(options.packageName, connection);
  } else {
    SecureLogger.error('No package name or file provided');
    process.exit(1);
  }

  if (options.maxObjects && objects.length > options.maxObjects) {
    SecureLogger.info(`\nLimiting to ${options.maxObjects} objects (of ${objects.length} total)`);
    objects = objects.slice(0, options.maxObjects);
  }

  if (objects.length === 0) {
    SecureLogger.error('No objects found to check');
    process.exit(1);
  }

  const concurrency = determineConcurrency(objects.length, options.concurrency);

  const mainReportsDir = process.env.REPORTS_DIR || 'reports';
  const outputDir = path.resolve(__dirname, mainReportsDir, 'atc');
  fs.mkdirSync(outputDir, { recursive: true });

  SecureLogger.info(`\nBatch Configuration:`);
  SecureLogger.info(`   Objects to check: ${objects.length}`);
  SecureLogger.info(`   Variant: ${variant}`);
  SecureLogger.info(`   Concurrency level: ${concurrency}`);
  SecureLogger.info(`   Estimated time: ~${Math.ceil(((objects.length / concurrency) * 10) / 60)} minutes`);

  const startTime = Date.now();
  const results = await runParallelBatchATC(
    objects,
    atcClient,
    concurrency,
    variant,
    options.includeDocumentation || false,
    outputDir
  );
  const totalDuration = Date.now() - startTime;

  const summary = generateBatchSummary(results, totalDuration);
  printBatchSummary(summary);

  SecureLogger.info(`\nIndividual reports saved to: ${outputDir}/`);
  SecureLogger.info(`Summary file updated: ${path.join(outputDir, 'atc_summary.md')}`);

  const hasErrors = summary.totalErrors > 0;
  process.exit(hasErrors ? 1 : 0);
}

main().catch(error => {
  SecureLogger.error('Batch check failed:', error);
  process.exit(1);
});
