#!/usr/bin/env node
/**
 * SAP ATC Check Variants - List available check variants on the SAP system
 *
 * Queries the SAP system via ADT API to discover all configured ATC check variants.
 * Useful for finding which variants are available before running checks.
 *
 * Usage: node --import tsx list-check-variants.ts [options]
 *
 * @version 1.0.0
 */

import { SAPATCClient } from './sap-atc-client.js';
import { loadEnvFileOnly, loadEnvFile } from './shared-utils.js';
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

async function main() {
  SecureLogger.info('\n SAP ATC Check Variants\n');

  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    SecureLogger.info('Usage: node --import tsx list-check-variants.ts [options]');
    SecureLogger.info('\nOptions:');
    SecureLogger.info('  --env PATH     Path to .env file');
    SecureLogger.info('  --json         Output as JSON');
    SecureLogger.info('  --help, -h     Show this help');
    SecureLogger.info('\nExamples:');
    SecureLogger.info('  node --import tsx list-check-variants.ts');
    SecureLogger.info('  node --import tsx list-check-variants.ts --json');
    process.exit(0);
  }

  let envFilePath: string | undefined;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && args[i + 1]) {
      envFilePath = args[i + 1];
      i++;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    }
  }

  const connection = loadEnvFile(envFilePath, ENV_PATH);
  if (!connection) {
    process.exit(1);
  }

  const client = new SAPATCClient(connection);
  const connected = await client.connect();

  if (!connected) {
    SecureLogger.error('Failed to connect to SAP system');
    process.exit(1);
  }

  const variants = await client.listCheckVariants();

  if (jsonOutput) {
    console.log(JSON.stringify(variants, null, 2));
  } else {
    if (variants.length === 0) {
      SecureLogger.info('No check variants discovered.');
      SecureLogger.info('');
      SecureLogger.info('This may mean:');
      SecureLogger.info('  - The /sap/bc/adt/atc/customizing endpoint is not available');
      SecureLogger.info('  - The user does not have authorization to list variants');
      SecureLogger.info('  - The SAP system uses only the default configuration');
      SecureLogger.info('');
      SecureLogger.info('Common ATC check variants (may be available on your system):');
      SecureLogger.info('');
      SecureLogger.info('  DEFAULT                       System default checks');
      SecureLogger.info('  CLEAN_CORE                    Clean Core compliance (S/4HANA)');
      SecureLogger.info('  ABAP_CLOUD_DEVELOPMENT_DEFAULT  ABAP Cloud readiness checks');
      SecureLogger.info('  S4HANA_READINESS              S/4HANA migration readiness');
      SecureLogger.info('  ZABAP_CLOUD_DEVELOPMENT       ABAP Cloud development (Z-variant)');
      SecureLogger.info('');
      SecureLogger.info('Try: node --import tsx run-atc-check.ts <OBJECT> --variant <VARIANT_NAME>');
    } else {
      SecureLogger.info('');
      SecureLogger.info('='.repeat(60));
      SecureLogger.info(' Available ATC Check Variants');
      SecureLogger.info('='.repeat(60));
      SecureLogger.info('');

      variants.forEach((v, idx) => {
        const defaultTag = v.isDefault ? ' [DEFAULT]' : '';
        SecureLogger.info(`  ${(idx + 1).toString().padStart(2)}. ${v.name}${defaultTag}`);
        if (v.description) {
          SecureLogger.info(`      ${v.description}`);
        }
      });

      SecureLogger.info('');
      SecureLogger.info('-'.repeat(60));
      SecureLogger.info('');
      SecureLogger.info('Usage:');
      SecureLogger.info(`  node --import tsx run-atc-check.ts <OBJECT> --variant ${variants[0].name}`);
      SecureLogger.info(`  node --import tsx batch-atc-parallel.ts <PACKAGE> --variant ${variants[0].name}`);
      SecureLogger.info('');
    }
  }

  process.exit(0);
}

main().catch(error => {
  SecureLogger.error('Unexpected error:', error);
  process.exit(1);
});
