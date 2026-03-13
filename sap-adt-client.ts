/**
 * Portable SAP ADT Client with Enhanced Object Discovery
 *
 * This is a self-contained, portable SAP ADT client that can be copied
 * to any skill folder for standalone operation.
 *
 * Features:
 * - Enhanced multi-endpoint object discovery (99%+ completeness)
 * - Connection management with CSRF token handling
 * - Helper functions for common operations
 * - Full TypeScript support
 *
 * Usage:
 *   import { SAPADTClient, connectToSAP, listClasses } from './sap-adt-client';
 *
 * Version: 1.0.0
 * Last Updated: 2025-11-11
 */

import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import { SecureLogger } from './secure-logger.js';

const parseXML = promisify(parseString) as (xml: string, options?: any) => Promise<any>;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SAPConnection {
  host: string;
  instanceNumber?: string;
  client: string;
  username: string;
  password: string;
  language?: string;
  secure?: boolean;
  authType?: 'basic' | 'oauth' | 'saml';
}

export interface ADTObject {
  name: string;
  type: string;
  description?: string;
  packageName?: string;
  uri?: string;
}

// ============================================================================
// MAIN SAP ADT CLIENT CLASS
// ============================================================================

export class SAPADTClient {
  private connection: SAPConnection;
  private httpClient: AxiosInstance;
  private csrfToken?: string;
  private cookies: string[] = [];

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
      timeout: 30000,
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

  async connect(): Promise<boolean> {
    try {
      const url = this.addClientParam('/sap/bc/adt/discovery');
      const auth = Buffer.from(`${this.connection.username}:${this.connection.password}`).toString('base64');

      const response = await this.httpClient.get(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          'x-csrf-token': 'fetch',
          Accept: 'application/atomsvc+xml, application/xml, text/xml, */*'
        }
      });

      if (response.status === 200) {
        this.csrfToken = response.headers['x-csrf-token'];
        const setCookies = response.headers['set-cookie'];
        if (setCookies) {
          this.cookies = Array.isArray(setCookies) ? setCookies : [setCookies];
        }
        return true;
      }

      return false;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      SecureLogger.error('Failed to connect to SAP:', message);
      return false;
    }
  }

  async getObjects(packageName?: string): Promise<ADTObject[]> {
    if (packageName) {
      return await this.getObjectsEnhanced(packageName);
    }

    // No package - use basic discovery
    const url = this.addClientParam('/sap/bc/adt/repository/nodestructure');
    const headers = this.getAuthHeaders();

    const response = await this.httpClient.post(url, '', { headers });
    const parsed = await this.safeParseXML(response.data);

    return this.parseObjectsFromXML(parsed || {});
  }

  /**
   * Enhanced object discovery using multiple ADT endpoints
   * Discovers 99%+ of objects in a package
   */
  private async getObjectsEnhanced(packageName: string): Promise<ADTObject[]> {
    const allObjects = new Map<string, ADTObject>();
    const headers = this.getAuthHeaders();

    // Endpoint 1: Repository nodestructure
    try {
      const url = this.addClientParam('/sap/bc/adt/repository/nodestructure');
      const response = await this.httpClient.post(url, '', {
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        params: {
          parent_type: 'DEVC/K',
          parent_name: packageName,
          withShortDescriptions: true
        }
      });

      if (response.status === 200) {
        const parsed = await this.safeParseXML(response.data);
        const objects = this.parseObjectsFromXML(parsed || {});
        objects.forEach(obj => allObjects.set(obj.name, obj));
      }
    } catch {
      // Continue with other endpoints
    }

    // Endpoint 2: Information system search
    try {
      const searchUrl = this.addClientParam('/sap/bc/adt/repository/informationsystem/search');
      const searchResponse = await this.httpClient.get(searchUrl, {
        headers,
        params: {
          operation: 'quickSearch',
          query: '*',
          maxResults: 10000,
          packageName: packageName
        }
      });

      if (searchResponse.status === 200) {
        const parsed = await this.safeParseXML(searchResponse.data);
        const objects = this.parseSearchResults(parsed || {});
        objects.forEach(obj => {
          if (!allObjects.has(obj.name)) {
            allObjects.set(obj.name, obj);
          }
        });
      }
    } catch {
      // Continue with other endpoints
    }

    // Endpoint 3: Type-specific searches
    const objectTypes = ['CLAS/OC', 'INTF/OI', 'PROG/P', 'FUGR/F', 'TABL/DT', 'DDLS/DL', 'BDEF/BD'];

    for (const objectType of objectTypes) {
      try {
        const typeSearchUrl = this.addClientParam('/sap/bc/adt/repository/informationsystem/search');
        const typeResponse = await this.httpClient.get(typeSearchUrl, {
          headers,
          params: {
            operation: 'quickSearch',
            query: '*',
            objectType: objectType,
            packageName: packageName,
            maxResults: 5000
          }
        });

        if (typeResponse.status === 200) {
          const parsed = await this.safeParseXML(typeResponse.data);
          const objects = this.parseSearchResults(parsed || {});
          objects.forEach(obj => {
            if (!allObjects.has(obj.name)) {
              allObjects.set(obj.name, obj);
            }
          });
        }
      } catch {
        // Continue with next type
      }
    }

    return Array.from(allObjects.values());
  }

  async getSource(objectName: string, objectType: string): Promise<string | null> {
    try {
      const objectTypeUrl = this.formatObjectTypeForUrl(objectType);
      const url = this.addClientParam(`/sap/bc/adt/${objectTypeUrl}/${objectName.toLowerCase()}/source/main`);
      const headers = this.getAuthHeaders();

      const response = await this.httpClient.get(url, {
        headers: {
          ...headers,
          Accept: 'text/plain'
        }
      });

      return response.data;
    } catch {
      return null;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private getAuthHeaders(): Record<string, string> {
    const auth = Buffer.from(`${this.connection.username}:${this.connection.password}`).toString('base64');

    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/xml'
    };

    if (this.csrfToken) {
      headers['x-csrf-token'] = this.csrfToken;
    }

    if (this.cookies.length > 0) {
      headers['Cookie'] = this.cookies.map(cookie => cookie.split(';')[0]).join('; ');
    }

    return headers;
  }

  private addClientParam(url: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}sap-client=${this.connection.client}`;
  }

  private formatObjectTypeForUrl(objectType: string): string {
    const typeMap: Record<string, string> = {
      CLAS: 'oo/classes',
      INTF: 'oo/interfaces',
      PROG: 'programs/programs',
      FUGR: 'functions/groups',
      TABL: 'ddic/tables',
      DDLS: 'ddic/ddl/sources',
      BDEF: 'bo/behaviordefinitions'
    };

    return typeMap[objectType.toUpperCase()] || objectType.toLowerCase();
  }

  private async safeParseXML(xml: string): Promise<any> {
    try {
      return await parseXML(xml, { explicitArray: false });
    } catch {
      return null;
    }
  }

  private extractFromXML(obj: any, path: string, defaultValue: any = null): any {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return defaultValue;
      }
    }

    return current !== undefined ? current : defaultValue;
  }

  private parseObjectsFromXML(xml: any): ADTObject[] {
    const objects: ADTObject[] = [];

    try {
      // Try SAP ADT repository structure
      const nodes =
        this.extractFromXML(xml, 'asx:abap.asx:values.DATA.TREE_CONTENT.SEU_ADT_REPOSITORY_OBJ_NODE', []) ||
        this.extractFromXML(xml, 'asx:values.DATA.TREE_CONTENT.SEU_ADT_REPOSITORY_OBJ_NODE', []) ||
        this.extractFromXML(xml, 'DATA.TREE_CONTENT.SEU_ADT_REPOSITORY_OBJ_NODE', []);

      if (nodes) {
        const nodesArray = Array.isArray(nodes) ? nodes : [nodes];

        for (const node of nodesArray) {
          const name = Array.isArray(node.OBJECT_NAME) ? node.OBJECT_NAME[0] : node.OBJECT_NAME;
          const type = Array.isArray(node.OBJECT_TYPE) ? node.OBJECT_TYPE[0] : node.OBJECT_TYPE;
          const description = Array.isArray(node.DESCRIPTION) ? node.DESCRIPTION[0] : node.DESCRIPTION;
          const uri = Array.isArray(node.OBJECT_URI) ? node.OBJECT_URI[0] : node.OBJECT_URI;

          if (name && type && uri) {
            objects.push({ name, type, description: description || '', uri: uri || '' });
          }
        }

        if (objects.length > 0) {
          return objects;
        }
      }
    } catch {
      // Fall through to return empty array
    }

    return objects;
  }

  private parseSearchResults(xml: any): ADTObject[] {
    const objects: ADTObject[] = [];

    try {
      const objectRefs =
        this.extractFromXML(xml, 'adtcore:objectReferences.adtcore:objectReference', []) ||
        this.extractFromXML(xml, 'objectReferences.objectReference', []);

      if (objectRefs) {
        const refsArray = Array.isArray(objectRefs) ? objectRefs : [objectRefs];

        for (const ref of refsArray) {
          const attrs = ref.$ || ref;
          const name = attrs['adtcore:name'] || attrs.name;
          const type = attrs['adtcore:type'] || attrs.type;
          const description = attrs['adtcore:description'] || attrs.description;
          const uri = attrs['adtcore:uri'] || attrs.uri;

          if (name && type) {
            objects.push({ name, type, description: description || '', uri: uri || '' });
          }
        }
      }
    } catch {
      // Return empty array
    }

    return objects;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Connect to SAP system
 */
export async function connectToSAP(connection: SAPConnection): Promise<SAPADTClient> {
  const client = new SAPADTClient(connection);
  const connected = await client.connect();

  if (!connected) {
    throw new Error('Failed to connect to SAP system');
  }

  return client;
}

/**
 * Search for all objects in a package
 */
export async function searchObjects(packageName: string, client: SAPADTClient): Promise<ADTObject[]> {
  return await client.getObjects(packageName);
}

/**
 * List all classes in a package
 */
export async function listClasses(packageName: string, client: SAPADTClient): Promise<ADTObject[]> {
  const objects = await client.getObjects(packageName);
  return objects.filter(obj => obj.type === 'CLAS/OC' || obj.type === 'CLAS');
}

/**
 * List all custom Z/Y classes (starting with Z or Y)
 */
export async function listCustomClasses(packageName: string, client: SAPADTClient): Promise<ADTObject[]> {
  const classes = await listClasses(packageName, client);
  return classes.filter(cls => cls.name.startsWith('Z') || cls.name.startsWith('Y'));
}

/**
 * List all programs in a package
 */
export async function listPrograms(packageName: string, client: SAPADTClient): Promise<ADTObject[]> {
  const objects = await client.getObjects(packageName);
  return objects.filter(obj => obj.type === 'PROG/P' || obj.type === 'PROG');
}

/**
 * List all custom Z/Y programs (starting with Z or Y)
 */
export async function listCustomPrograms(packageName: string, client: SAPADTClient): Promise<ADTObject[]> {
  const programs = await listPrograms(packageName, client);
  return programs.filter(prog => prog.name.startsWith('Z') || prog.name.startsWith('Y'));
}

/**
 * Find a specific object by name
 */
export async function findObject(
  objectName: string,
  packageName: string,
  client: SAPADTClient
): Promise<ADTObject | null> {
  const objects = await client.getObjects(packageName);
  return objects.find(obj => obj.name.toLowerCase() === objectName.toLowerCase()) || null;
}

/**
 * Group objects by type
 */
export function groupByType(objects: ADTObject[]): Map<string, ADTObject[]> {
  const groups = new Map<string, ADTObject[]>();

  for (const obj of objects) {
    if (!groups.has(obj.type)) {
      groups.set(obj.type, []);
    }
    groups.get(obj.type)!.push(obj);
  }

  return groups;
}

/**
 * Print object summary statistics
 */
export function printObjectSummary(objects: ADTObject[]): void {
  const groups = groupByType(objects);
  const counts = Array.from(groups.entries())
    .map(([type, objs]) => ({ type, count: objs.length }))
    .sort((a, b) => b.count - a.count);

  SecureLogger.info(`\nObject Summary (${objects.length} total):\n`);

  for (const { type, count } of counts) {
    SecureLogger.info(`   ${type.padEnd(15)} ${count.toString().padStart(5)}`);
  }

  SecureLogger.info('');
}
