/**
 * SAP ATC (ABAP Test Cockpit) Client - Reusable Module
 *
 * Provides programmatic access to SAP ATC checks via ADT API.
 * Supports any ATC check variant (DEFAULT, CLEAN_CORE, S4HANA_READINESS, custom, etc.).
 *
 * @version 1.0.0 - General-purpose ATC checker (variant-agnostic)
 */

import { SAPConnection } from './sap-adt-client.js';
import { SecureLogger } from './secure-logger.js';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { parseString } from 'xml2js';
import { promisify } from 'util';

const parseXML = promisify(parseString);

// ============================================================================
// EXPORTED TYPE DEFINITIONS
// ============================================================================

/**
 * ATC check result for a single finding
 */
export interface ATCResult {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  line?: number;
  checkId?: string;
  checkTitle?: string;
  messageId?: string;
  priority?: string;
  priorityDescription?: string;
  documentationUrl?: string;
  documentation?: string;
  // Quickfix information
  quickfixAvailable?: boolean;
  quickfixType?: 'automatic' | 'manual' | 'pseudo' | 'none';
  quickfixInfo?: string;
}

/**
 * ATC check execution options
 */
export interface ATCCheckOptions {
  objectName: string;
  objectType?: string; // Optional - will auto-detect if not provided
  variant?: string; // Check variant name (e.g., 'DEFAULT', 'CLEAN_CORE', custom)
  includeDocumentation?: boolean; // Default: true
  maxWaitTime?: number; // Default: 300000 (5 min)
  pollInterval?: number; // Default: 5000 (5 sec)
}

/**
 * Complete ATC check result with metadata
 */
export interface ATCCheckResult {
  objectName: string;
  objectType: string;
  variant: string;
  findings: ATCResult[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
  };
  overallPriority: number; // 0=none, 1=error, 2=warning, 3=info
  overallPriorityText: string;
  systemInfo: {
    sid: string;
    host: string;
    client: string;
    checkDate: string;
  };
  duration: number;
  status: 'success' | 'failed';
  errorMessage?: string;
}

/**
 * ATC check variant information
 */
export interface ATCCheckVariant {
  name: string;
  description?: string;
  isDefault?: boolean;
}

// ============================================================================
// INTERNAL TYPE DEFINITIONS (not exported)
// ============================================================================

interface ATCWorklist {
  id: string;
  timestamp: string;
  objects: ATCObject[];
}

interface ATCObject {
  uri: string;
  type: string;
  name: string;
  packageName: string;
  findings: ATCFinding[];
}

interface ATCFinding {
  uri: string;
  location: string;
  priority: number;
  checkId: string;
  checkTitle: string;
  messageId: string;
  messageTitle: string;
  quickfixInfo: string;
  documentationUrl?: string;
  tags: ATCTag[];
  // Quickfix details
  quickfixManual?: boolean;
  quickfixAutomatic?: boolean;
  quickfixPseudo?: boolean;
}

interface ATCTag {
  name: string;
  value: string;
}

interface ATCRunStatus {
  status: 'running' | 'finished' | 'failed';
  resultUrl?: string;
  worklistUrl?: string;
}

interface ObjectReference {
  uri: string;
}

// ============================================================================
// EXPORTED UTILITY FUNCTIONS
// ============================================================================

/**
 * Escape special characters for safe XML construction
 * Prevents XML injection when building XML strings with user input
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validate SAP object name format
 * SAP object names are alphanumeric with underscores and namespace slashes, max 40 chars
 */
export function validateObjectName(name: string): boolean {
  if (!name || name.length > 40) return false;
  return /^[A-Za-z0-9_/]+$/.test(name);
}

/**
 * Safely extract values from parsed XML objects
 * @param obj Parsed XML object
 * @param path Dot-notation path (e.g., 'worklist.objects.object')
 * @param defaultValue Value to return if path not found
 */
export function safeExtractFromXML(obj: any, path: string, defaultValue: any = undefined): any {
  try {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current[part] === undefined) {
        return defaultValue;
      }
      current = current[part];

      if (Array.isArray(current) && current.length === 1) {
        current = current[0];
      }
    }

    return current;
  } catch {
    return defaultValue;
  }
}

/**
 * Format object type for ADT URL path
 * @param objectType Object type (e.g., 'CLAS/OC', 'PROG/P')
 * @returns URL path segment (e.g., 'oo/classes', 'programs/programs')
 */
export function formatObjectTypeForUrl(objectType: string): string {
  const typeMap: Record<string, string> = {
    PROG: 'programs/programs',
    'PROG/P': 'programs/programs',
    'PROG/I': 'programs/includes',
    CLAS: 'oo/classes',
    'CLAS/OC': 'oo/classes',
    'CLAS/I': 'oo/classes',
    INTF: 'oo/interfaces',
    FUGR: 'functions/groups',
    FUNC: 'functions/functions',
    DTEL: 'ddic/dataelements',
    TABL: 'ddic/tables',
    STRU: 'ddic/structures',
    DDLS: 'ddic/ddl/sources',
    BDEF: 'bo/behaviordefinitions',
    SRVD: 'ddic/srvd/sources',
    SRVB: 'businessservices/bindings'
  };

  return typeMap[objectType.toUpperCase()] || objectType.toLowerCase();
}

/**
 * Determine overall priority from findings (worst priority wins)
 * @param results Array of ATC findings
 * @returns Worst priority found: 0=none, 1=error, 2=warning, 3=info
 */
export function determineOverallPriority(results: ATCResult[]): number {
  if (results.length === 0) return 0;

  const priorities = results.map(r => parseInt(r.priority || '3')).filter(p => !isNaN(p));
  if (priorities.length === 0) return 0;

  // Priority 1 is worst (error), so find minimum non-zero value
  return Math.min(...priorities);
}

/**
 * Get human-readable text for an ATC priority
 * @param priority ATC priority number
 * @returns Description string
 */
export function getPriorityText(priority: number): string {
  switch (priority) {
    case 0:
      return 'No Findings';
    case 1:
      return 'Very High (Blocker)';
    case 2:
      return 'High (Error)';
    case 3:
      return 'Medium (Warning)';
    case 4:
      return 'Low (Information)';
    default:
      return `Priority ${priority}`;
  }
}

/**
 * Get SAP SID from environment variable
 * @returns Uppercase 3-character SID or 'UNK' if not set
 */
export function getSAPSID(): string {
  const sid = process.env.SAP_SID || 'UNK';

  // Validate SID format (should be 3 alphanumeric characters)
  if (sid.length !== 3 || !/^[A-Z0-9]{3}$/i.test(sid)) {
    SecureLogger.warn(`SAP_SID "${sid}" is not standard format (should be 3 alphanumeric chars). Using as-is.`);
  }

  return sid.toUpperCase();
}

// ============================================================================
// SAP ATC CLIENT CLASS
// ============================================================================

/**
 * SAP ATC (ABAP Test Cockpit) Client
 *
 * Provides programmatic access to SAP ATC checks via ADT API.
 * Supports any check variant configured on the SAP system.
 *
 * @example
 * ```typescript
 * const client = new SAPATCClient(connection);
 * await client.connect();
 * const result = await client.checkObject({
 *   objectName: 'ZCL_MY_CLASS',
 *   variant: 'DEFAULT'
 * });
 * console.log(`Found ${result.summary.errors} errors`);
 * ```
 */
export class SAPATCClient {
  private connection: SAPConnection;
  private httpClient: AxiosInstance;
  private csrfToken?: string;
  private cookies: string[] = [];
  private connected: boolean = false;

  constructor(connection: SAPConnection) {
    this.connection = connection;

    // Determine base URL
    let baseURL: string;
    const cleanHost = connection.host.replace(/^https?:\/\//, '');

    if (cleanHost.includes(':')) {
      baseURL = `${connection.secure ? 'https' : 'http'}://${cleanHost}`;
    } else {
      if (connection.instanceNumber) {
        const httpPort = connection.secure
          ? 44300 + parseInt(connection.instanceNumber)
          : 8000 + parseInt(connection.instanceNumber);
        baseURL = `${connection.secure ? 'https' : 'http'}://${cleanHost}:${httpPort}`;
      } else {
        baseURL = `${connection.secure ? 'https' : 'http'}://${cleanHost}`;
      }
    }

    this.httpClient = axios.create({
      baseURL,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/xml',
        Accept: 'application/xml'
      },
      httpsAgent: connection.secure
        ? new https.Agent({
            rejectUnauthorized: process.env.SAP_REJECT_UNAUTHORIZED !== 'false'
          })
        : undefined
    });
  }

  private addClientParam(url: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}sap-client=${this.connection.client}`;
  }

  private getAuthHeader(): string {
    const credentials = Buffer.from(`${this.connection.username}:${this.connection.password}`).toString('base64');
    return `Basic ${credentials}`;
  }

  private async getHeaders(includeCsrf: boolean = true): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/xml',
      'User-Agent': 'SAP-ATC-Checker/1.0'
    };

    if (this.cookies.length > 0) {
      headers['Cookie'] = this.cookies.map(c => c.split(';')[0]).join('; ');
    }

    if (includeCsrf && this.csrfToken) {
      headers['x-csrf-token'] = this.csrfToken;
    }

    return headers;
  }

  /**
   * Connect to SAP system and obtain CSRF token
   * @returns True if connection successful
   */
  async connect(): Promise<boolean> {
    try {
      SecureLogger.info(`Connecting to SAP system...`);

      const url = this.addClientParam('/sap/bc/adt/discovery');
      const response = await this.httpClient.get(url, {
        headers: {
          Authorization: this.getAuthHeader(),
          'x-sap-adt-sessiontype': 'stateful',
          'x-csrf-token': 'fetch',
          Accept: 'application/atomsvc+xml, application/xml, text/xml, */*'
        }
      });

      if (response.status !== 200) {
        SecureLogger.error(`Connection failed: ${response.status} - ${response.statusText}`);
        return false;
      }

      // Store cookies
      const setCookieHeaders = response.headers['set-cookie'];
      if (setCookieHeaders) {
        this.cookies = setCookieHeaders;
      }

      // Extract CSRF token
      this.csrfToken = response.headers['x-csrf-token'];

      if (!this.csrfToken) {
        SecureLogger.error('No CSRF token received from server');
        return false;
      }

      this.connected = true;
      SecureLogger.info('Successfully connected to SAP system');
      return true;
    } catch (error: any) {
      SecureLogger.error('Connection error:', error.message);
      if (error.response?.status === 401) {
        SecureLogger.error('   Authentication failed - check username and password');
      }
      return false;
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * List available ATC check variants on the SAP system.
   *
   * Uses two ADT endpoints (from /sap/bc/adt/discovery):
   * 1. /sap/bc/adt/atc/customizing - returns systemCheckVariant (the default)
   * 2. /sap/bc/adt/atc/variants    - returns user-defined variant list
   *
   * @returns Array of check variant information
   */
  async listCheckVariants(): Promise<ATCCheckVariant[]> {
    const variants: ATCCheckVariant[] = [];

    // Step 1: Get system default variant from /atc/customizing
    try {
      SecureLogger.info('Retrieving ATC customizing (system default variant)...');
      const custUrl = this.addClientParam('/sap/bc/adt/atc/customizing');
      const custResponse = await this.httpClient.get(custUrl, {
        headers: {
          ...(await this.getHeaders(false)),
          Accept: 'application/xml'
        }
      });

      if (custResponse.status === 200) {
        const parsed = await parseXML(custResponse.data);
        const systemVariant = this.parseSystemCheckVariant(parsed);
        if (systemVariant) {
          variants.push({
            name: systemVariant,
            description: 'System default check variant',
            isDefault: true
          });
        }
      }
    } catch (error: any) {
      SecureLogger.error('Could not retrieve ATC customizing:', error);
    }

    // Step 2: Get user-defined variants from /atc/variants
    try {
      SecureLogger.info('Retrieving user-defined ATC check variants...');
      const varUrl = this.addClientParam('/sap/bc/adt/atc/variants');
      const varResponse = await this.httpClient.get(varUrl, {
        headers: {
          ...(await this.getHeaders(false)),
          Accept: 'application/xml'
        }
      });

      if (varResponse.status === 200) {
        const parsed = await parseXML(varResponse.data);
        const userVariants = this.parseVariantList(parsed);
        for (const uv of userVariants) {
          // Avoid duplicating the system default
          if (!variants.some(v => v.name === uv.name)) {
            variants.push(uv);
          }
        }
      }
    } catch (error: any) {
      SecureLogger.error('Could not retrieve variant list:', error);
    }

    return variants;
  }

  /**
   * Parse the systemCheckVariant from /atc/customizing response.
   *
   * Expected XML structure:
   * <atc:customizing xmlns:atc="http://www.sap.com/adt/atc">
   *   <properties>
   *     <property name="systemCheckVariant" value="VARIANT_NAME"/>
   *     ...
   *   </properties>
   * </atc:customizing>
   */
  private parseSystemCheckVariant(xml: any): string | null {
    try {
      // Navigate to properties
      const properties =
        safeExtractFromXML(xml, 'atc:customizing.properties.property', []) ||
        safeExtractFromXML(xml, 'customizing.properties.property', []);

      const propsArray = Array.isArray(properties) ? properties : [properties];

      for (const prop of propsArray) {
        if (!prop || !prop.$) continue;
        const propName = prop.$.name || '';
        const propValue = prop.$.value || '';
        if (propName === 'systemCheckVariant' && propValue) {
          return propValue;
        }
      }
    } catch {
      // Return null
    }
    return null;
  }

  /**
   * Parse the variant list from /atc/variants response.
   *
   * Expected XML structure:
   * <nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem">
   *   <nameditem:totalItemCount>N</nameditem:totalItemCount>
   *   <nameditem:namedItem name="VARIANT_NAME" description="..."/>
   *   ...
   * </nameditem:namedItemList>
   */
  private parseVariantList(xml: any): ATCCheckVariant[] {
    const variants: ATCCheckVariant[] = [];

    try {
      const items =
        safeExtractFromXML(xml, 'nameditem:namedItemList.nameditem:namedItem', []) ||
        safeExtractFromXML(xml, 'namedItemList.namedItem', []);

      const itemsArray = Array.isArray(items) ? items : [items];

      for (const item of itemsArray) {
        if (!item) continue;
        const attrs = item.$ || item;
        const name = attrs['nameditem:name'] || attrs.name;
        if (name) {
          variants.push({
            name,
            description: attrs['nameditem:description'] || attrs.description || '',
            isDefault: false
          });
        }
      }
    } catch {
      // Return whatever we have
    }

    return variants;
  }

  /**
   * Discover object type by name (auto-detection)
   * @param objectName Object name to search for
   * @returns Object type (e.g., 'CLAS/OC', 'PROG/P') or null if not found
   */
  async discoverObjectType(objectName: string): Promise<string | null> {
    try {
      SecureLogger.info(`Discovering object type for: ${objectName}`);

      // Try to search for the object with enhanced discovery
      const url = this.addClientParam(
        `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=${encodeURIComponent(objectName)}&maxResults=10000`
      );

      const response = await this.httpClient.get(url, {
        headers: await this.getHeaders(false)
      });

      if (response.status === 200) {
        const parsed = await parseXML(response.data);
        const objects = safeExtractFromXML(parsed, 'adtcore:objectReferences.adtcore:objectReference', []);
        const objectsArray = Array.isArray(objects) ? objects : [objects];

        for (const obj of objectsArray) {
          if (obj && obj.$) {
            const name = obj.$['adtcore:name'];
            const type = obj.$['adtcore:type'];

            if (name === objectName.toUpperCase()) {
              SecureLogger.info(`Object found: ${name} (Type: ${type})`);
              return type;
            }
          }
        }
      }

      SecureLogger.info(`Object ${objectName} not found in SAP system`);

      // Search for similar objects
      await this.searchForSimilarObjects(objectName);

      return null;
    } catch (error: any) {
      SecureLogger.error('Error discovering object type:', error);
      return null;
    }
  }

  /**
   * Search for similar objects (helper for typos/mistakes)
   * @param objectName Partial or incorrect object name
   */
  async searchForSimilarObjects(objectName: string): Promise<void> {
    SecureLogger.info(`\nSearching for similar objects...`);

    try {
      // Search with wildcards
      const searchPatterns = [
        `*${objectName}*`, // Contains
        `${objectName}*`, // Starts with
        `*${objectName}` // Ends with
      ];

      const allResults: any[] = [];

      for (const pattern of searchPatterns) {
        const url = this.addClientParam(
          `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=${encodeURIComponent(pattern)}&maxResults=100`
        );

        try {
          const response = await this.httpClient.get(url, {
            headers: await this.getHeaders(false)
          });

          if (response.status === 200) {
            const parsed = await parseXML(response.data);
            const objects = safeExtractFromXML(parsed, 'adtcore:objectReferences.adtcore:objectReference', []);
            const objectsArray = Array.isArray(objects) ? objects : [objects];

            objectsArray.forEach((obj: any) => {
              if (obj && obj.$) {
                const name = obj.$['adtcore:name'];
                const existing = allResults.find(r => r.name === name);
                if (!existing && name) {
                  allResults.push({
                    name: name,
                    type: obj.$['adtcore:type'],
                    description: obj.$['adtcore:description'] || '',
                    packageName: obj.$['adtcore:packageName'] || ''
                  });
                }
              }
            });
          }
        } catch {
          // Continue with next pattern
        }
      }

      if (allResults.length > 0) {
        SecureLogger.info(`\nFound ${allResults.length} similar object(s):\n`);
        SecureLogger.info('='.repeat(80));

        // Group by type
        const byType = allResults.reduce((acc: any, obj: any) => {
          const type = obj.type;
          if (!acc[type]) acc[type] = [];
          acc[type].push(obj);
          return acc;
        }, {});

        Object.entries(byType).forEach(([type, objects]: [string, any]) => {
          SecureLogger.info(`\n${type} (${objects.length}):`);
          objects.slice(0, 10).forEach((obj: any, idx: number) => {
            SecureLogger.info(`   ${(idx + 1).toString().padStart(2)}. ${obj.name}`);
            if (obj.description) {
              SecureLogger.info(`       ${obj.description}`);
            }
          });
          if (objects.length > 10) {
            SecureLogger.info(`       ... and ${objects.length - 10} more`);
          }
        });

        SecureLogger.info('\n' + '='.repeat(80));
        SecureLogger.info('\nTry one of these objects:');
        SecureLogger.info(`   node --import tsx run-atc-check.ts <OBJECT_NAME>`);
        SecureLogger.info('');
      } else {
        SecureLogger.info(`No similar objects found`);
      }
    } catch {
      SecureLogger.error('   Search failed');
    }
  }

  /**
   * Run ATC check on a single object (recommended API)
   *
   * @param options ATC check options
   * @returns Complete check result with findings and metadata
   *
   * @example
   * ```typescript
   * const result = await client.checkObject({
   *   objectName: 'ZCL_MY_CLASS',
   *   variant: 'DEFAULT',
   *   includeDocumentation: true
   * });
   * ```
   */
  async checkObject(options: ATCCheckOptions): Promise<ATCCheckResult> {
    const startTime = Date.now();
    const variant = options.variant || 'DEFAULT';

    // Step 1: Validate connection and input
    if (!this.connected) {
      throw new Error('Not connected. Call connect() first.');
    }

    if (!validateObjectName(options.objectName)) {
      return {
        objectName: options.objectName,
        objectType: 'UNKNOWN',
        variant,
        findings: [],
        summary: { total: 0, errors: 0, warnings: 0, info: 0 },
        overallPriority: 0,
        overallPriorityText: 'No Findings',
        systemInfo: {
          sid: getSAPSID(),
          host: this.connection.host,
          client: this.connection.client,
          checkDate: new Date().toISOString()
        },
        duration: Date.now() - startTime,
        status: 'failed',
        errorMessage: `Invalid object name: "${options.objectName}". Must be alphanumeric with underscores/slashes, max 40 chars.`
      };
    }

    // Step 2: Auto-detect object type if not provided
    let objectType = options.objectType;
    if (!objectType) {
      objectType = await this.discoverObjectType(options.objectName);
      if (!objectType) {
        return {
          objectName: options.objectName,
          objectType: 'UNKNOWN',
          variant,
          findings: [],
          summary: { total: 0, errors: 0, warnings: 0, info: 0 },
          overallPriority: 0,
          overallPriorityText: 'No Findings',
          systemInfo: {
            sid: getSAPSID(),
            host: this.connection.host,
            client: this.connection.client,
            checkDate: new Date().toISOString()
          },
          duration: Date.now() - startTime,
          status: 'failed',
          errorMessage: `Object ${options.objectName} not found`
        };
      }
    }

    // Step 3: Run ATC check
    try {
      const findings = await this.runATCCheck(
        options.objectName,
        objectType,
        variant,
        options.includeDocumentation ?? true
      );

      // Step 4: Build structured result
      const summary = {
        total: findings.length,
        errors: findings.filter(f => f.severity === 'ERROR').length,
        warnings: findings.filter(f => f.severity === 'WARNING').length,
        info: findings.filter(f => f.severity === 'INFO').length
      };

      const overallPriority = determineOverallPriority(findings);

      return {
        objectName: options.objectName,
        objectType,
        variant,
        findings,
        summary,
        overallPriority,
        overallPriorityText: getPriorityText(overallPriority),
        systemInfo: {
          sid: getSAPSID(),
          host: this.connection.host,
          client: this.connection.client,
          checkDate: new Date().toISOString()
        },
        duration: Date.now() - startTime,
        status: 'success'
      };
    } catch (error: any) {
      return {
        objectName: options.objectName,
        objectType,
        variant,
        findings: [],
        summary: { total: 0, errors: 0, warnings: 0, info: 0 },
        overallPriority: 0,
        overallPriorityText: 'No Findings',
        systemInfo: {
          sid: getSAPSID(),
          host: this.connection.host,
          client: this.connection.client,
          checkDate: new Date().toISOString()
        },
        duration: Date.now() - startTime,
        status: 'failed',
        errorMessage: error.message
      };
    }
  }

  /**
   * Run ATC check and return raw findings
   *
   * @param objectName Object to check
   * @param objectType Object type
   * @param variant Check variant (e.g., 'DEFAULT', 'CLEAN_CORE')
   * @param includeDocumentation Fetch documentation for findings
   * @returns Array of findings
   */
  async runATCCheck(
    objectName: string,
    objectType: string,
    variant: string = 'DEFAULT',
    includeDocumentation: boolean = true
  ): Promise<ATCResult[]> {
    if (!validateObjectName(objectName)) {
      SecureLogger.error(`Invalid object name: "${objectName}"`);
      return [];
    }

    try {
      SecureLogger.info(`\nStarting ATC Check`);
      SecureLogger.info(`   Object: ${objectName} (${objectType})`);
      SecureLogger.info(`   Variant: ${variant}`);
      SecureLogger.info(`   Documentation: ${includeDocumentation ? 'Yes' : 'No'}`);

      // Step 1: Create ATC Worklist
      SecureLogger.info('\nStep 1/5: Creating ATC worklist...');
      const worklistId = await this.createATCWorklist(variant);

      // Step 2: Start ATC Run
      SecureLogger.info('Step 2/5: Starting ATC run...');
      const objectRefs = this.buildObjectReferences(objectName, objectType);
      const runId = await this.startATCRun(worklistId, objectRefs);

      // Step 3: Poll Run Status
      SecureLogger.info('Step 3/5: Waiting for ATC run to complete...');
      await this.waitForATCRunCompletion(runId, 300000, 5000);

      // Step 4: Get Worklist Results
      SecureLogger.info('Step 4/5: Retrieving results...');
      const worklist = await this.getATCWorklist(worklistId, false);

      // Step 5: Convert and enrich results
      SecureLogger.info('Step 5/5: Processing findings...');
      const results = this.convertWorklistToResults(worklist);

      if (includeDocumentation && results.length > 0) {
        SecureLogger.info(`Fetching documentation for ${results.length} findings...`);
        await this.enrichResultsWithDocumentation(results);
      }

      SecureLogger.info(`\nATC check completed. Found ${results.length} findings.`);
      return results;
    } catch (error: any) {
      SecureLogger.error('ATC check error:', error);
      return [];
    }
  }

  private async createATCWorklist(variant: string): Promise<string> {
    const url = this.addClientParam(`/sap/bc/adt/atc/worklists?checkVariant=${encodeURIComponent(variant)}`);

    const response = await this.httpClient.post(url, '', {
      headers: {
        ...(await this.getHeaders()),
        Accept: 'text/plain'
      }
    });

    if (response.status === 200 && response.data) {
      return response.data.trim();
    }

    throw new Error(`Failed to create ATC worklist: ${response.status}`);
  }

  private async startATCRun(worklistId: string, objectReferences: ObjectReference[]): Promise<string> {
    const url = this.addClientParam(
      `/sap/bc/adt/atc/runs?worklistId=${encodeURIComponent(worklistId)}&clientWait=false`
    );

    const runXML = `<?xml version="1.0" encoding="UTF-8"?>
<atc:run maximumVerdicts="100" xmlns:atc="http://www.sap.com/adt/atc">
  <objectSets xmlns:adtcore="http://www.sap.com/adt/core">
    <objectSet kind="inclusive">
      <adtcore:objectReferences>
        ${objectReferences.map(ref => `<adtcore:objectReference adtcore:uri="${escapeXml(ref.uri)}"/>`).join('\n        ')}
      </adtcore:objectReferences>
    </objectSet>
  </objectSets>
</atc:run>`;

    const response = await this.httpClient.post(url, runXML, {
      headers: {
        ...(await this.getHeaders()),
        'Content-Type': 'application/xml',
        Accept: 'application/xml'
      }
    });

    if (response.status === 201) {
      const location = response.headers['location'];
      if (location) {
        const runId = location.split('/').pop();
        return runId!;
      }
    }

    throw new Error(`Failed to start ATC run: ${response.status}`);
  }

  private async getATCRunStatus(runId: string): Promise<ATCRunStatus> {
    const url = this.addClientParam(`/sap/bc/adt/atc/runs/${encodeURIComponent(runId)}`);

    const response = await this.httpClient.get(url, {
      headers: {
        ...(await this.getHeaders(false)),
        Accept: 'application/vnd.sap.adt.backgroundrun.v1+xml'
      }
    });

    if (response.status === 200) {
      const parsed = await parseXML(response.data);
      const status = safeExtractFromXML(parsed, 'runs:run.$.runs:status', 'running');
      return { status: status as any };
    }

    throw new Error(`Failed to get ATC run status: ${response.status}`);
  }

  private async waitForATCRunCompletion(runId: string, maxWaitTime: number, pollInterval: number): Promise<void> {
    const startTime = Date.now();
    let dots = 0;

    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getATCRunStatus(runId);

      if (status.status === 'finished') {
        SecureLogger.info('   Completed');
        return;
      }

      if (status.status === 'failed') {
        throw new Error('ATC run failed');
      }

      dots++;
      if (dots % 10 === 0) {
        SecureLogger.info(`   Polling... ${dots * (pollInterval / 1000)}s elapsed`);
      }

      await this.sleep(pollInterval);
    }

    throw new Error(`ATC run timeout after ${maxWaitTime}ms`);
  }

  private async getATCWorklist(worklistId: string, includeExempted: boolean): Promise<ATCWorklist> {
    const url = this.addClientParam(
      `/sap/bc/adt/atc/worklists/${encodeURIComponent(worklistId)}?includeExemptedFindings=${includeExempted}`
    );

    const response = await this.httpClient.get(url, {
      headers: {
        ...(await this.getHeaders(false)),
        Accept: 'application/atc.worklist.v1+xml'
      }
    });

    if (response.status === 200) {
      const parsed = await parseXML(response.data);
      return this.parseATCWorklist(parsed);
    }

    throw new Error(`Failed to get ATC worklist: ${response.status}`);
  }

  private async getATCDocumentation(itemId: string, index: number): Promise<string> {
    const url = this.addClientParam(`/sap/bc/adt/documentation/atc/documents/itemid/${itemId}/index/${index}`);

    const response = await this.httpClient.get(url, {
      headers: {
        ...(await this.getHeaders(false)),
        Accept: 'application/vnd.sap.adt.docu.v1+html, text/html'
      }
    });

    if (response.status === 200) {
      return response.data;
    }

    throw new Error(`Failed to get ATC documentation: ${response.status}`);
  }

  private buildObjectReferences(objectName: string, objectType: string): ObjectReference[] {
    return [
      {
        uri: `/sap/bc/adt/${formatObjectTypeForUrl(objectType)}/${encodeURIComponent(objectName.toLowerCase())}/source/main`
      }
    ];
  }

  private parseATCWorklist(xml: any): ATCWorklist {
    const worklist: ATCWorklist = {
      id: safeExtractFromXML(xml, 'atcworklist:worklist.$.atcworklist:id', ''),
      timestamp: safeExtractFromXML(xml, 'atcworklist:worklist.$.atcworklist:timestamp', ''),
      objects: []
    };

    const objects = safeExtractFromXML(xml, 'atcworklist:worklist.atcworklist:objects.atcobject:object', []);
    const objectsArray = Array.isArray(objects) ? objects : [objects];

    for (const obj of objectsArray) {
      if (!obj) continue;

      const objAttrs = obj.$;
      const atcObject: ATCObject = {
        uri: objAttrs['adtcore:uri'] || objAttrs.uri || '',
        type: objAttrs['adtcore:type'] || objAttrs.type || '',
        name: objAttrs['adtcore:name'] || objAttrs.name || '',
        packageName: objAttrs['adtcore:packageName'] || objAttrs.packageName || '',
        findings: []
      };

      const findings = safeExtractFromXML(obj, 'atcobject:findings.atcfinding:finding', []);
      const findingsArray = Array.isArray(findings) ? findings : [findings];

      for (const finding of findingsArray) {
        if (!finding) continue;

        // Extract attributes - they're prefixed with namespace
        const attrs = finding.$;
        const rawPriority = attrs['atcfinding:priority'] || attrs.priority;
        const priority = parseInt(rawPriority || '3');

        const atcFinding: ATCFinding = {
          uri: attrs['adtcore:uri'] || attrs.uri || '',
          location: attrs['atcfinding:location'] || attrs.location || '',
          priority: priority,
          checkId: attrs['atcfinding:checkId'] || attrs.checkId || '',
          checkTitle: attrs['atcfinding:checkTitle'] || attrs.checkTitle || '',
          messageId: attrs['atcfinding:messageId'] || attrs.messageId || '',
          messageTitle: attrs['atcfinding:messageTitle'] || attrs.messageTitle || '',
          quickfixInfo: attrs['atcfinding:quickfixInfo'] || attrs.quickfixInfo || '',
          tags: []
        };

        // Extract documentation URL
        const docLink = safeExtractFromXML(finding, 'atom:link', null);
        if (docLink && docLink.$.rel === 'http://www.sap.com/adt/relations/documentation') {
          atcFinding.documentationUrl = docLink.$.href;
        }

        // Extract quickfix information
        const quickfixes = safeExtractFromXML(finding, 'atcfinding:quickfixes', null);
        if (quickfixes && quickfixes.$) {
          const qfAttrs = quickfixes.$;
          atcFinding.quickfixManual = (qfAttrs['atcfinding:manual'] || qfAttrs.manual) === 'true';
          atcFinding.quickfixAutomatic = (qfAttrs['atcfinding:automatic'] || qfAttrs.automatic) === 'true';
          atcFinding.quickfixPseudo = (qfAttrs['atcfinding:pseudo'] || qfAttrs.pseudo) === 'true';
        }

        atcObject.findings.push(atcFinding);
      }

      worklist.objects.push(atcObject);
    }

    return worklist;
  }

  private convertWorklistToResults(worklist: ATCWorklist): ATCResult[] {
    const results: ATCResult[] = [];

    for (const obj of worklist.objects) {
      for (const finding of obj.findings) {
        const line = this.extractLineFromLocation(finding.location);

        // Determine quickfix availability and type
        let quickfixAvailable = false;
        let quickfixType: 'automatic' | 'manual' | 'pseudo' | 'none' = 'none';

        if (finding.quickfixAutomatic) {
          quickfixAvailable = true;
          quickfixType = 'automatic';
        } else if (finding.quickfixManual) {
          quickfixAvailable = true;
          quickfixType = 'manual';
        } else if (finding.quickfixPseudo) {
          quickfixAvailable = true;
          quickfixType = 'pseudo';
        }

        results.push({
          severity: this.mapPriorityToSeverity(finding.priority),
          message: finding.messageTitle || finding.checkTitle,
          line,
          checkId: finding.checkId,
          checkTitle: finding.checkTitle,
          messageId: finding.messageId,
          priority: finding.priority.toString(),
          priorityDescription: getPriorityText(finding.priority),
          documentationUrl: finding.documentationUrl,
          quickfixAvailable,
          quickfixType,
          quickfixInfo: finding.quickfixInfo
        });
      }
    }

    return results;
  }

  private async enrichResultsWithDocumentation(results: ATCResult[]): Promise<void> {
    for (const result of results) {
      if (result.documentationUrl) {
        try {
          const itemId = this.extractItemId(result.documentationUrl);
          const index = this.extractIndex(result.documentationUrl);

          if (itemId && index !== null) {
            result.documentation = await this.getATCDocumentation(itemId, index);
          }
        } catch {
          // Silently skip documentation errors
        }
      }
    }
  }

  private extractLineFromLocation(location: string): number | undefined {
    if (!location) return undefined;

    const patterns = [/#start=(\d+),/, /line=(\d+)/, /:(\d+):/, /start=(\d+)/];

    for (const pattern of patterns) {
      const match = location.match(pattern);
      if (match) {
        const lineNum = parseInt(match[1]);
        return lineNum > 0 ? lineNum : undefined;
      }
    }

    return undefined;
  }

  private extractItemId(url: string): string | null {
    const match = url.match(/\/itemid\/([A-Z0-9]{32})\//);
    return match ? match[1] : null;
  }

  private extractIndex(url: string): number | null {
    const match = url.match(/\/index\/(\d+)$/);
    return match ? parseInt(match[1]) : null;
  }

  private mapPriorityToSeverity(priority: number): 'ERROR' | 'WARNING' | 'INFO' {
    switch (priority) {
      case 1:
        return 'ERROR';
      case 2:
        return 'WARNING';
      default:
        return 'INFO';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
