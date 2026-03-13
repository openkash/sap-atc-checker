#!/usr/bin/env node
/**
 * SAP ATC Check - CLI Interface
 *
 * This script performs SAP ATC (ABAP Test Cockpit) checks using any configured
 * check variant to validate ABAP code quality.
 *
 * Usage: node --import tsx run-atc-check.ts <objectName> [options]
 *
 * @version 1.0.0 - General-purpose ATC checker (variant-agnostic)
 */

import { SAPATCClient, ATCResult, determineOverallPriority, getSAPSID, validateObjectName } from './sap-atc-client.js';
import { loadEnvFileOnly, loadEnvFile, saveReportToFile, updateSummaryFile } from './shared-utils.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { SecureLogger } from './secure-logger.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment immediately at module level
const ENV_PATH = loadEnvFileOnly(__dirname);

// Initialize SecureLogger (after env is loaded)
const logsDir = process.env.LOGS_DIR || 'logs';
SecureLogger.configure({
  logToFile: process.env.LOG_TO_FILE === 'true',
  logDir: resolve(__dirname, logsDir),
  verbose: false,
  quiet: false
});

// ==================== MAIN EXECUTION ====================

function formatResults(results: ATCResult[], variant: string): void {
  if (results.length === 0) {
    SecureLogger.info(`\n No ATC findings with variant ${variant}! \n`);
    return;
  }

  SecureLogger.info('\n' + '='.repeat(80));
  SecureLogger.info(` ATC CHECK RESULTS (Variant: ${variant})`);
  SecureLogger.info('='.repeat(80));

  // Summary
  const summary = results.reduce(
    (acc, r) => {
      acc[r.severity] = (acc[r.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  SecureLogger.info('\n Summary:');
  if (summary.ERROR) SecureLogger.info(`    Errors:   ${summary.ERROR}`);
  if (summary.WARNING) SecureLogger.info(`    Warnings: ${summary.WARNING}`);
  if (summary.INFO) SecureLogger.info(`    Info:     ${summary.INFO}`);

  SecureLogger.info('\n' + '-'.repeat(80));
  SecureLogger.info(' Detailed Findings:\n');

  // Group by severity
  const errors = results.filter(r => r.severity === 'ERROR');
  const warnings = results.filter(r => r.severity === 'WARNING');
  const info = results.filter(r => r.severity === 'INFO');

  const printFindings = (findings: ATCResult[], label: string) => {
    if (findings.length === 0) return;

    SecureLogger.info(`\n ${label} (${findings.length}):`);
    SecureLogger.info('-'.repeat(80));

    findings.forEach((finding, idx) => {
      SecureLogger.info(`\n${idx + 1}. ${finding.message}`);
      if (finding.line) SecureLogger.info(`    Line: ${finding.line}`);
      if (finding.checkId) SecureLogger.info(`    Check: ${finding.checkId}`);
      if (finding.priority) SecureLogger.info(`    Priority: ${finding.priority} - ${finding.priorityDescription}`);

      // Display quickfix information
      if (finding.quickfixAvailable) {
        const qfLabel =
          finding.quickfixType === 'automatic'
            ? 'Automatic fix available'
            : finding.quickfixType === 'manual'
              ? 'Manual fix available'
              : 'Pseudo fix available';
        SecureLogger.info(`    Quickfix: ${qfLabel}`);
      } else {
        SecureLogger.info(`    No quickfix available`);
      }

      if (finding.documentation) {
        // Extract key info from HTML documentation
        const descMatch = finding.documentation.match(/<h3>Description<\/h3><p>([^<]*)/i);
        const whatYouCanDo = finding.documentation.match(/<STRONG>What you can do:<\/STRONG>([\s\S]*?)(?=<STRONG>|$)/i);

        if (descMatch?.[1]) {
          SecureLogger.info(`    ${descMatch[1].trim()}`);
        }
        if (whatYouCanDo?.[1]) {
          const action = whatYouCanDo[1]
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (action) SecureLogger.info(`    Action: ${action.substring(0, 150)}...`);
        }
      }
    });
  };

  printFindings(errors, 'ERRORS');
  printFindings(warnings, 'WARNINGS');
  printFindings(info, 'INFO');

  SecureLogger.info('\n' + '='.repeat(80) + '\n');
}

async function main() {
  SecureLogger.info('\n SAP ATC Checker\n');

  // Parse arguments
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    SecureLogger.info('Usage: node --import tsx run-atc-check.ts <objectName> [options]');
    SecureLogger.info('\nOptions:');
    SecureLogger.info('  --variant, -V NAME   ATC check variant (default: system default)');
    SecureLogger.info('  --output, -o FILE    Save report to file (default: auto-save to reports/atc/)');
    SecureLogger.info('  --no-save            Do not save report to file');
    SecureLogger.info('  --env PATH           Path to .env file');
    SecureLogger.info('  --help, -h           Show this help');
    SecureLogger.info('\nExamples:');
    SecureLogger.info('  node --import tsx run-atc-check.ts ZCL_MY_CLASS');
    SecureLogger.info('  node --import tsx run-atc-check.ts ZCL_MY_CLASS --variant CLEAN_CORE');
    SecureLogger.info('  node --import tsx run-atc-check.ts ZCL_MY_CLASS --variant S4HANA_READINESS');
    SecureLogger.info('  node --import tsx run-atc-check.ts ZCL_MY_CLASS --output ./my-report.md');
    SecureLogger.info('  node --import tsx run-atc-check.ts ZCL_MY_CLASS --no-save');
    process.exit(args.length === 0 ? 1 : 0);
  }

  const objectName = args[0].toUpperCase();

  // Validate object name to prevent injection
  if (!validateObjectName(objectName)) {
    SecureLogger.error(`Invalid object name: "${args[0]}"`);
    SecureLogger.error('   Object names must be alphanumeric with underscores and slashes, max 40 characters.');
    process.exit(1);
  }

  let outputFile: string | null = null;
  let noSave = false;
  let envFilePath: string | undefined;
  let variant: string | undefined;

  // Parse options
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      outputFile = args[i + 1];
      i++;
    } else if (args[i] === '--no-save') {
      noSave = true;
    } else if (args[i] === '--variant' || args[i] === '-V') {
      variant = args[i + 1];
      i++;
    } else if (args[i] === '--env') {
      envFilePath = args[i + 1];
      i++;
    } else if (!args[i].startsWith('-')) {
      // Assume it's env file path for backward compatibility
      envFilePath = args[i];
    }
  }

  // Validate output path stays within project directory
  if (outputFile) {
    const resolvedOutput = path.resolve(outputFile);
    const projectRoot = path.resolve(__dirname);
    if (!resolvedOutput.startsWith(projectRoot)) {
      SecureLogger.error(`Output path must be within the project directory: ${projectRoot}`);
      process.exit(1);
    }
  }

  // Set default output file if not specified and not no-save
  if (!noSave && !outputFile) {
    const reportsDir = process.env.REPORTS_DIR || 'reports';
    const outputDir = resolve(__dirname, reportsDir, 'atc');
    fs.mkdirSync(outputDir, { recursive: true });
    outputFile = resolve(outputDir, `${objectName}_atc.md`);
  }

  // Load connection details
  const connection = loadEnvFile(envFilePath, ENV_PATH);
  if (!connection) {
    if (!envFilePath) {
      SecureLogger.error('\n No .env file found in current directory.');
      SecureLogger.error(
        '   Please provide the path: node --import tsx run-atc-check.ts <objectName> --env /path/to/.env'
      );
    }
    process.exit(1);
  }

  // Create client and connect
  const client = new SAPATCClient(connection);
  const connected = await client.connect();

  if (!connected) {
    SecureLogger.error(' Failed to connect to SAP system');
    process.exit(1);
  }

  // If no variant specified, try to get the system default
  if (!variant) {
    SecureLogger.info('No --variant specified, using system default...');
    const variants = await client.listCheckVariants();
    const defaultVariant = variants.find(v => v.isDefault);
    if (defaultVariant) {
      variant = defaultVariant.name;
      SecureLogger.info(`Using default variant: ${variant}`);
    } else if (variants.length > 0) {
      variant = variants[0].name;
      SecureLogger.info(`Using first available variant: ${variant}`);
    } else {
      variant = 'DEFAULT';
      SecureLogger.info(`No variants discovered, using: ${variant}`);
    }
  }

  // Discover object type
  const objectType = await client.discoverObjectType(objectName);
  if (!objectType) {
    SecureLogger.error(` Could not find object ${objectName} in SAP system`);
    process.exit(1);
  }

  // Run ATC check
  const results = await client.runATCCheck(objectName, objectType, variant, true);

  // Format and display results
  formatResults(results, variant);

  // Save report to file
  if (outputFile) {
    await saveReportToFile(objectName, objectType, results, variant, outputFile, {
      sid: getSAPSID(),
      host: connection.host,
      client: connection.client
    });
    SecureLogger.info(`\n Report saved to: ${outputFile}`);

    // Update summary file
    const outputDir = path.dirname(outputFile);
    const overallPriority = determineOverallPriority(results);
    await updateSummaryFile(objectName, objectType, overallPriority, results.length, variant, outputDir);
    SecureLogger.info(` Summary updated: ${path.resolve(outputDir, 'atc_summary.md')}`);
  }

  // Exit with appropriate code
  const hasErrors = results.some(r => r.severity === 'ERROR');
  process.exit(hasErrors ? 1 : 0);
}

// Execute
main().catch(error => {
  SecureLogger.error(' Unexpected error:', error);
  process.exit(1);
});
