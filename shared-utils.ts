/**
 * Shared utilities for SAP ATC Checker CLI scripts
 *
 * Provides common functions used across run-atc-check.ts,
 * batch-atc-parallel.ts, and list-check-variants.ts.
 */

import { SAPConnection } from './sap-adt-client.js';
import { ATCResult, getPriorityText } from './sap-atc-client.js';
import { SecureLogger } from './secure-logger.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// ENVIRONMENT LOADING
// ============================================================================

/**
 * Attempt to load .env from a known location (project root).
 * Call once at module load time to populate process.env.
 *
 * @param skillDir __dirname of the calling script
 * @returns The path that was loaded, or null
 */
export function loadEnvFileOnly(skillDir: string): string | null {
  // Check current directory (standalone repo root)
  const localEnv = path.resolve(skillDir, '.env');
  if (fs.existsSync(localEnv)) {
    dotenv.config({ path: localEnv });
    return localEnv;
  }
  // Fallback: check two levels up (embedded skill in parent project)
  const parentEnv = path.resolve(skillDir, '../../.env');
  if (fs.existsSync(parentEnv)) {
    dotenv.config({ path: parentEnv });
    return parentEnv;
  }
  return null;
}

/**
 * Load SAP connection details from environment.
 *
 * @param envPath Optional custom .env file path
 * @param preloadedEnvPath Path loaded by loadEnvFileOnly (for logging)
 * @returns SAPConnection or null if configuration is missing
 */
export function loadEnvFile(envPath?: string, preloadedEnvPath?: string | null): SAPConnection | null {
  if (envPath) {
    const envFilePath = path.resolve(envPath);
    if (!fs.existsSync(envFilePath)) {
      SecureLogger.error(`.env file not found at: ${envFilePath}`);
      return null;
    }
    SecureLogger.info(`Loading custom environment from: ${envFilePath}`);
    dotenv.config({ path: envFilePath, override: true });
  } else if (preloadedEnvPath) {
    SecureLogger.info(`Using environment from: ${preloadedEnvPath}`);
  } else {
    SecureLogger.error('No .env file found');
    return null;
  }

  const host = process.env.SAP_HOST;
  const client = process.env.SAP_CLIENT;
  const username = process.env.SAP_USERNAME;
  const password = process.env.SAP_PASSWORD;

  if (!host || !client || !username || !password) {
    SecureLogger.error('Missing required environment variables:');
    SecureLogger.error('   Required: SAP_HOST, SAP_CLIENT, SAP_USERNAME, SAP_PASSWORD');
    return null;
  }

  return {
    host,
    client,
    username,
    password,
    instanceNumber: process.env.SAP_INSTANCE_NUMBER,
    language: process.env.SAP_LANGUAGE || 'EN',
    secure: process.env.SAP_SECURE === 'true',
    authType: 'basic' as const
  };
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

/**
 * Save an ATC check report for a single object to a markdown file.
 */
export async function saveReportToFile(
  objectName: string,
  objectType: string,
  results: ATCResult[],
  variant: string,
  outputFile: string,
  systemInfo: { sid?: string; host?: string; client?: string }
): Promise<void> {
  const lines: string[] = [];

  lines.push(`# ATC Check Report`);
  lines.push('');
  lines.push(`**Object:** ${objectName}`);
  lines.push(`**Type:** ${objectType}`);
  lines.push(`**Check Variant:** ${variant}`);
  lines.push(`**SAP System:** ${systemInfo.sid || 'UNK'}`);
  lines.push(`**Host:** ${systemInfo.host || ''}`);
  lines.push(`**Client:** ${systemInfo.client || ''}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const summary = results.reduce(
    (acc, r) => {
      acc[r.severity] = (acc[r.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const totalFindings = results.length;
  const errorCount = summary.ERROR || 0;
  const warningCount = summary.WARNING || 0;
  const infoCount = summary.INFO || 0;

  const statusText =
    totalFindings === 0
      ? 'Passed - No Findings'
      : errorCount > 0
        ? 'Failed - Errors Found'
        : 'Passed with Warnings/Info';

  lines.push(`## ${statusText}`);
  lines.push('');
  lines.push(`### Summary`);
  lines.push('');
  lines.push(`- **Total Findings:** ${totalFindings}`);
  if (errorCount > 0) lines.push(`- **Errors:** ${errorCount}`);
  if (warningCount > 0) lines.push(`- **Warnings:** ${warningCount}`);
  if (infoCount > 0) lines.push(`- **Info:** ${infoCount}`);
  lines.push('');

  if (totalFindings === 0) {
    lines.push('**No findings! This object passed all ATC checks.**');
    lines.push('');
  } else {
    lines.push('---');
    lines.push('');
    lines.push('## Detailed Findings');
    lines.push('');

    const errors = results.filter(r => r.severity === 'ERROR');
    const warnings = results.filter(r => r.severity === 'WARNING');
    const info = results.filter(r => r.severity === 'INFO');

    const writeFindingSection = (findings: ATCResult[], title: string) => {
      if (findings.length === 0) return;

      lines.push(`### ${title} (${findings.length})`);
      lines.push('');
      findings.forEach((finding, idx) => {
        lines.push(`#### ${idx + 1}. ${finding.message}`);
        lines.push('');
        if (finding.line) lines.push(`- **Line:** ${finding.line}`);
        if (finding.checkId) lines.push(`- **Check ID:** ${finding.checkId}`);
        if (finding.priority) lines.push(`- **Priority:** ${finding.priority} - ${finding.priorityDescription}`);
        if (finding.quickfixAvailable !== undefined) {
          lines.push(`- **Quickfix:** ${finding.quickfixAvailable ? finding.quickfixType : 'Not available'}`);
        }
        lines.push('');
      });
    };

    writeFindingSection(errors, 'Errors');
    writeFindingSection(warnings, 'Warnings');
    writeFindingSection(info, 'Info');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Recommendations');
  lines.push('');

  if (errorCount > 0) {
    lines.push('### Critical Actions');
    lines.push('');
    lines.push(`1. **Address ${errorCount} error(s)** before transport`);
    lines.push('2. Review line numbers in the detailed findings above');
    lines.push('3. Check for automatic quickfixes in ADT');
    lines.push('');
  }

  if (warningCount > 0) {
    lines.push('### Review Actions');
    lines.push('');
    lines.push(`1. **Review ${warningCount} warning(s)** and plan remediation`);
    lines.push('2. Consider creating technical debt items for complex fixes');
    lines.push('');
  }

  if (totalFindings === 0) {
    lines.push('No actions required. This object passed all ATC checks.');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*Generated by SAP ATC Checker*');
  lines.push('');

  fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
}

/**
 * Update or create a summary markdown file aggregating results across objects.
 */
export async function updateSummaryFile(
  objectName: string,
  objectType: string,
  overallPriority: number,
  findingCount: number,
  variant: string,
  outputDir: string
): Promise<void> {
  const summaryFile = path.join(outputDir, 'atc_summary.md');
  const summaryData: any[] = [];

  if (fs.existsSync(summaryFile)) {
    try {
      const content = fs.readFileSync(summaryFile, 'utf-8');
      const rows = content.split('\n').filter(line => line.trim().startsWith('|') && !line.includes('---'));
      rows.slice(1).forEach(row => {
        const cols = row
          .split('|')
          .map(c => c.trim())
          .filter(Boolean);
        if (cols.length >= 4) {
          summaryData.push({
            object: cols[0],
            type: cols[1],
            priority: cols[2],
            findings: parseInt(cols[3]) || 0
          });
        }
      });
    } catch {
      // Start fresh
    }
  }

  const priorityText = getPriorityText(overallPriority);
  const existingIndex = summaryData.findIndex(item => item.object.trim() === objectName);
  const newEntry = {
    object: objectName,
    type: objectType,
    priority: priorityText,
    findings: findingCount
  };

  if (existingIndex >= 0) {
    summaryData[existingIndex] = newEntry;
  } else {
    summaryData.push(newEntry);
  }

  const priorityOrder: Record<string, number> = {
    'Very High (Blocker)': 0,
    'High (Error)': 1,
    'Medium (Warning)': 2,
    'Low (Information)': 3,
    'No Findings': 4
  };
  summaryData.sort((a, b) => {
    const pDiff = (priorityOrder[a.priority] ?? 5) - (priorityOrder[b.priority] ?? 5);
    if (pDiff !== 0) return pDiff;
    return a.object.localeCompare(b.object);
  });

  const lines: string[] = [];
  lines.push('# ATC Check Summary');
  lines.push('');
  lines.push(`**Last Updated:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Check Variant:** ${variant}`);
  lines.push('');
  lines.push('## Overview');
  lines.push('');

  const priorityCounts = summaryData.reduce(
    (acc, item) => {
      acc[item.priority] = (acc[item.priority] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  lines.push(`- **Total Objects Checked:** ${summaryData.length}`);
  if (priorityCounts['Very High (Blocker)'])
    lines.push(`- **With Blockers:** ${priorityCounts['Very High (Blocker)']}`);
  if (priorityCounts['High (Error)']) lines.push(`- **With Errors:** ${priorityCounts['High (Error)']}`);
  if (priorityCounts['Medium (Warning)']) lines.push(`- **With Warnings:** ${priorityCounts['Medium (Warning)']}`);
  if (priorityCounts['No Findings']) lines.push(`- **Clean (No Findings):** ${priorityCounts['No Findings']}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Objects');
  lines.push('');
  lines.push('| Object | Type | Worst Priority | Findings |');
  lines.push('|--------|------|----------------|----------|');

  summaryData.forEach(item => {
    lines.push(`| ${item.object} | ${item.type} | ${item.priority} | ${item.findings} |`);
  });

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Generated by SAP ATC Checker*');
  lines.push('');

  fs.writeFileSync(summaryFile, lines.join('\n'), 'utf-8');
}
