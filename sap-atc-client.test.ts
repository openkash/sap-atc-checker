import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  safeExtractFromXML,
  formatObjectTypeForUrl,
  determineOverallPriority,
  getPriorityText,
  getSAPSID,
  escapeXml,
  validateObjectName,
  SAPATCClient,
  ATCResult
} from './sap-atc-client.js';

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('safeExtractFromXML', () => {
  it('extracts a simple nested value', () => {
    const xml = { a: { b: { c: 'value' } } };
    expect(safeExtractFromXML(xml, 'a.b.c')).toBe('value');
  });

  it('returns default when path not found', () => {
    const xml = { a: { b: 'value' } };
    expect(safeExtractFromXML(xml, 'a.x.y', 'fallback')).toBe('fallback');
  });

  it('returns undefined when path not found and no default', () => {
    const xml = { a: {} };
    expect(safeExtractFromXML(xml, 'a.b.c')).toBeUndefined();
  });

  it('unwraps single-element arrays', () => {
    const xml = { a: [{ b: 'value' }] };
    expect(safeExtractFromXML(xml, 'a.b')).toBe('value');
  });

  it('does not unwrap multi-element arrays', () => {
    const xml = { a: [{ b: 'v1' }, { b: 'v2' }] };
    const result = safeExtractFromXML(xml, 'a');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('handles null input gracefully', () => {
    expect(safeExtractFromXML(null, 'a.b', 'default')).toBe('default');
  });

  it('handles undefined input gracefully', () => {
    expect(safeExtractFromXML(undefined, 'a', 'default')).toBe('default');
  });

  it('handles empty path', () => {
    const xml = { '': 'value' };
    expect(safeExtractFromXML(xml, '', 'default')).toBe('value');
  });

  it('handles deeply nested structures', () => {
    const xml = { a: { b: { c: { d: { e: 'deep' } } } } };
    expect(safeExtractFromXML(xml, 'a.b.c.d.e')).toBe('deep');
  });
});

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    expect(escapeXml('A&B')).toBe('A&amp;B');
  });

  it('escapes less-than', () => {
    expect(escapeXml('A<B')).toBe('A&lt;B');
  });

  it('escapes greater-than', () => {
    expect(escapeXml('A>B')).toBe('A&gt;B');
  });

  it('escapes double quotes', () => {
    expect(escapeXml('A"B')).toBe('A&quot;B');
  });

  it('escapes single quotes', () => {
    expect(escapeXml("A'B")).toBe('A&apos;B');
  });

  it('escapes multiple special characters', () => {
    expect(escapeXml('<script>"alert(\'xss\')&"</script>')).toBe(
      '&lt;script&gt;&quot;alert(&apos;xss&apos;)&amp;&quot;&lt;/script&gt;'
    );
  });

  it('returns normal strings unchanged', () => {
    expect(escapeXml('ZCL_MY_CLASS')).toBe('ZCL_MY_CLASS');
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });
});

describe('validateObjectName', () => {
  it('accepts valid SAP object names', () => {
    expect(validateObjectName('ZCL_MY_CLASS')).toBe(true);
    expect(validateObjectName('Y_TEST_PROG')).toBe(true);
    expect(validateObjectName('CL_ABAP_TYPEDESCR')).toBe(true);
  });

  it('accepts names with slashes (namespaces)', () => {
    expect(validateObjectName('/NAMESPACE/CLASS')).toBe(true);
    expect(validateObjectName('/DMO/CL_TEST')).toBe(true);
  });

  it('rejects names with XML special characters', () => {
    expect(validateObjectName('ZCL<EVIL>')).toBe(false);
    expect(validateObjectName('ZCL"TEST')).toBe(false);
    expect(validateObjectName('ZCL&TEST')).toBe(false);
  });

  it('rejects empty names', () => {
    expect(validateObjectName('')).toBe(false);
  });

  it('rejects names over 40 characters', () => {
    expect(validateObjectName('A'.repeat(41))).toBe(false);
  });

  it('accepts names up to 40 characters', () => {
    expect(validateObjectName('A'.repeat(40))).toBe(true);
  });
});

describe('formatObjectTypeForUrl', () => {
  it('maps PROG to programs/programs', () => {
    expect(formatObjectTypeForUrl('PROG')).toBe('programs/programs');
  });

  it('maps PROG/P to programs/programs', () => {
    expect(formatObjectTypeForUrl('PROG/P')).toBe('programs/programs');
  });

  it('maps PROG/I to programs/includes', () => {
    expect(formatObjectTypeForUrl('PROG/I')).toBe('programs/includes');
  });

  it('maps CLAS to oo/classes', () => {
    expect(formatObjectTypeForUrl('CLAS')).toBe('oo/classes');
  });

  it('maps CLAS/OC to oo/classes', () => {
    expect(formatObjectTypeForUrl('CLAS/OC')).toBe('oo/classes');
  });

  it('maps CLAS/I to oo/classes', () => {
    expect(formatObjectTypeForUrl('CLAS/I')).toBe('oo/classes');
  });

  it('maps INTF to oo/interfaces', () => {
    expect(formatObjectTypeForUrl('INTF')).toBe('oo/interfaces');
  });

  it('maps FUGR to functions/groups', () => {
    expect(formatObjectTypeForUrl('FUGR')).toBe('functions/groups');
  });

  it('maps FUNC to functions/functions', () => {
    expect(formatObjectTypeForUrl('FUNC')).toBe('functions/functions');
  });

  it('maps DTEL to ddic/dataelements', () => {
    expect(formatObjectTypeForUrl('DTEL')).toBe('ddic/dataelements');
  });

  it('maps TABL to ddic/tables', () => {
    expect(formatObjectTypeForUrl('TABL')).toBe('ddic/tables');
  });

  it('maps STRU to ddic/structures', () => {
    expect(formatObjectTypeForUrl('STRU')).toBe('ddic/structures');
  });

  it('maps DDLS to ddic/ddl/sources', () => {
    expect(formatObjectTypeForUrl('DDLS')).toBe('ddic/ddl/sources');
  });

  it('maps BDEF to bo/behaviordefinitions (per SAP ADT discovery)', () => {
    expect(formatObjectTypeForUrl('BDEF')).toBe('bo/behaviordefinitions');
  });

  it('maps SRVD to ddic/srvd/sources (per SAP ADT discovery)', () => {
    expect(formatObjectTypeForUrl('SRVD')).toBe('ddic/srvd/sources');
  });

  it('maps SRVB to businessservices/bindings (per SAP ADT discovery)', () => {
    expect(formatObjectTypeForUrl('SRVB')).toBe('businessservices/bindings');
  });

  it('is case-insensitive', () => {
    expect(formatObjectTypeForUrl('prog')).toBe('programs/programs');
    expect(formatObjectTypeForUrl('Clas')).toBe('oo/classes');
  });

  it('returns lowercase for unknown types', () => {
    expect(formatObjectTypeForUrl('XYZZY')).toBe('xyzzy');
  });
});

describe('determineOverallPriority', () => {
  it('returns 0 for empty results', () => {
    expect(determineOverallPriority([])).toBe(0);
  });

  it('returns 1 when errors exist', () => {
    const results: ATCResult[] = [
      { severity: 'ERROR', message: 'err', priority: '1' },
      { severity: 'WARNING', message: 'warn', priority: '2' }
    ];
    expect(determineOverallPriority(results)).toBe(1);
  });

  it('returns 2 when warnings are worst', () => {
    const results: ATCResult[] = [
      { severity: 'WARNING', message: 'warn', priority: '2' },
      { severity: 'INFO', message: 'info', priority: '3' }
    ];
    expect(determineOverallPriority(results)).toBe(2);
  });

  it('returns 3 for info-only findings', () => {
    const results: ATCResult[] = [{ severity: 'INFO', message: 'info', priority: '3' }];
    expect(determineOverallPriority(results)).toBe(3);
  });

  it('handles missing priority gracefully', () => {
    const results: ATCResult[] = [{ severity: 'INFO', message: 'info' }];
    expect(determineOverallPriority(results)).toBe(3);
  });

  it('handles results with only undefined priorities', () => {
    const results: ATCResult[] = [
      { severity: 'INFO', message: 'a', priority: undefined },
      { severity: 'INFO', message: 'b', priority: undefined }
    ];
    // undefined priorities default to '3' in parseInt
    expect(determineOverallPriority(results)).toBe(3);
  });
});

describe('getPriorityText', () => {
  it('returns correct text for priority 0', () => {
    expect(getPriorityText(0)).toBe('No Findings');
  });

  it('returns correct text for priority 1', () => {
    expect(getPriorityText(1)).toBe('Very High (Blocker)');
  });

  it('returns correct text for priority 2', () => {
    expect(getPriorityText(2)).toBe('High (Error)');
  });

  it('returns correct text for priority 3', () => {
    expect(getPriorityText(3)).toBe('Medium (Warning)');
  });

  it('returns correct text for priority 4', () => {
    expect(getPriorityText(4)).toBe('Low (Information)');
  });

  it('returns generic text for unknown priority', () => {
    expect(getPriorityText(99)).toBe('Priority 99');
  });
});

describe('getSAPSID', () => {
  const originalEnv = process.env.SAP_SID;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SAP_SID = originalEnv;
    } else {
      delete process.env.SAP_SID;
    }
  });

  it('returns UNK when SAP_SID is not set', () => {
    delete process.env.SAP_SID;
    expect(getSAPSID()).toBe('UNK');
  });

  it('returns the SID uppercased', () => {
    process.env.SAP_SID = 'a4h';
    expect(getSAPSID()).toBe('A4H');
  });

  it('returns the SID as-is when already uppercase', () => {
    process.env.SAP_SID = 'PRD';
    expect(getSAPSID()).toBe('PRD');
  });

  it('warns for non-standard SID format', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.SAP_SID = 'AB';
    getSAPSID();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ============================================================================
// SAP ATC CLIENT - XML PARSING TESTS
// ============================================================================

describe('SAPATCClient - parseSystemCheckVariant', () => {
  // We test the private method indirectly through listCheckVariants,
  // but for thorough coverage we can test the XML parsing logic
  // by creating a minimal client and inspecting its behavior.

  const mockConnection = {
    host: 'test.sap.com:50000',
    client: '001',
    username: 'TEST',
    password: 'TEST',
    secure: false
  };

  it('parses systemCheckVariant from customizing XML', async () => {
    const client = new SAPATCClient(mockConnection);

    // Mock the httpClient via prototype
    const customizingXml = `<?xml version="1.0" encoding="utf-8"?>
      <atc:customizing xmlns:atc="http://www.sap.com/adt/atc">
        <properties>
          <property name="ciCheckFlavour" value="true"/>
          <property name="systemCheckVariant" value="MY_VARIANT"/>
          <property name="isCCSTunnelEnabled" value="false"/>
        </properties>
      </atc:customizing>`;

    // Mock connect + HTTP calls
    const mockGet = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        data: 'csrf-response',
        headers: { 'x-csrf-token': 'token123', 'set-cookie': ['cookie1'] }
      })
      .mockResolvedValueOnce({ status: 200, data: customizingXml })
      .mockResolvedValueOnce({
        status: 200,
        data: '<?xml version="1.0"?><nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"><nameditem:totalItemCount>0</nameditem:totalItemCount></nameditem:namedItemList>'
      });

    (client as any).httpClient.get = mockGet;

    await client.connect();
    const variants = await client.listCheckVariants();

    expect(variants).toHaveLength(1);
    expect(variants[0].name).toBe('MY_VARIANT');
    expect(variants[0].isDefault).toBe(true);
    expect(variants[0].description).toBe('System default check variant');
  });

  it('parses user-defined variants from /atc/variants', async () => {
    const client = new SAPATCClient(mockConnection);

    const customizingXml = `<?xml version="1.0"?>
      <atc:customizing xmlns:atc="http://www.sap.com/adt/atc">
        <properties>
          <property name="systemCheckVariant" value="DEFAULT"/>
        </properties>
      </atc:customizing>`;

    const variantsXml = `<?xml version="1.0"?>
      <nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem">
        <nameditem:totalItemCount>2</nameditem:totalItemCount>
        <nameditem:namedItem name="CLEAN_CORE" description="Clean Core checks"/>
        <nameditem:namedItem name="PERFORMANCE" description="Performance checks"/>
      </nameditem:namedItemList>`;

    const mockGet = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: 'ok', headers: { 'x-csrf-token': 'tok', 'set-cookie': [] } })
      .mockResolvedValueOnce({ status: 200, data: customizingXml })
      .mockResolvedValueOnce({ status: 200, data: variantsXml });

    (client as any).httpClient.get = mockGet;

    await client.connect();
    const variants = await client.listCheckVariants();

    expect(variants).toHaveLength(3);
    expect(variants[0]).toEqual({ name: 'DEFAULT', description: 'System default check variant', isDefault: true });
    expect(variants[1]).toEqual({ name: 'CLEAN_CORE', description: 'Clean Core checks', isDefault: false });
    expect(variants[2]).toEqual({ name: 'PERFORMANCE', description: 'Performance checks', isDefault: false });
  });

  it('deduplicates when system variant also appears in variant list', async () => {
    const client = new SAPATCClient(mockConnection);

    const customizingXml = `<?xml version="1.0"?>
      <atc:customizing xmlns:atc="http://www.sap.com/adt/atc">
        <properties>
          <property name="systemCheckVariant" value="CLEAN_CORE"/>
        </properties>
      </atc:customizing>`;

    const variantsXml = `<?xml version="1.0"?>
      <nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem">
        <nameditem:totalItemCount>1</nameditem:totalItemCount>
        <nameditem:namedItem name="CLEAN_CORE" description="Clean Core variant"/>
      </nameditem:namedItemList>`;

    const mockGet = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: 'ok', headers: { 'x-csrf-token': 'tok', 'set-cookie': [] } })
      .mockResolvedValueOnce({ status: 200, data: customizingXml })
      .mockResolvedValueOnce({ status: 200, data: variantsXml });

    (client as any).httpClient.get = mockGet;

    await client.connect();
    const variants = await client.listCheckVariants();

    expect(variants).toHaveLength(1);
    expect(variants[0].name).toBe('CLEAN_CORE');
    expect(variants[0].isDefault).toBe(true);
  });

  it('returns empty array when both endpoints fail', async () => {
    const client = new SAPATCClient(mockConnection);

    const mockGet = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: 'ok', headers: { 'x-csrf-token': 'tok', 'set-cookie': [] } })
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'));

    (client as any).httpClient.get = mockGet;

    // Suppress console.error during test
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await client.connect();
    const variants = await client.listCheckVariants();

    expect(variants).toHaveLength(0);
    errSpy.mockRestore();
  });

  it('returns system variant when /atc/variants fails', async () => {
    const client = new SAPATCClient(mockConnection);

    const customizingXml = `<?xml version="1.0"?>
      <atc:customizing xmlns:atc="http://www.sap.com/adt/atc">
        <properties>
          <property name="systemCheckVariant" value="DEFAULT"/>
        </properties>
      </atc:customizing>`;

    const mockGet = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: 'ok', headers: { 'x-csrf-token': 'tok', 'set-cookie': [] } })
      .mockResolvedValueOnce({ status: 200, data: customizingXml })
      .mockRejectedValueOnce(new Error('403 Forbidden'));

    (client as any).httpClient.get = mockGet;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await client.connect();
    const variants = await client.listCheckVariants();

    expect(variants).toHaveLength(1);
    expect(variants[0].name).toBe('DEFAULT');
    errSpy.mockRestore();
  });
});

// ============================================================================
// SAP ATC CLIENT - CONNECT TESTS
// ============================================================================

describe('SAPATCClient - connect', () => {
  const mockConnection = {
    host: 'test.sap.com:50000',
    client: '001',
    username: 'TEST',
    password: 'TEST',
    secure: false
  };

  it('connects successfully and stores CSRF token', async () => {
    const client = new SAPATCClient(mockConnection);

    const mockGet = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: '<discovery/>',
      headers: {
        'x-csrf-token': 'mytoken123',
        'set-cookie': ['SAP_SESSIONID=abc; path=/']
      }
    });
    (client as any).httpClient.get = mockGet;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await client.connect();
    logSpy.mockRestore();

    expect(result).toBe(true);
    expect(client.isConnected()).toBe(true);
  });

  it('fails when status is not 200', async () => {
    const client = new SAPATCClient(mockConnection);

    const mockGet = vi.fn().mockResolvedValueOnce({
      status: 403,
      statusText: 'Forbidden',
      data: '',
      headers: {}
    });
    (client as any).httpClient.get = mockGet;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await client.connect();
    errSpy.mockRestore();
    logSpy.mockRestore();

    expect(result).toBe(false);
    expect(client.isConnected()).toBe(false);
  });

  it('fails when no CSRF token returned', async () => {
    const client = new SAPATCClient(mockConnection);

    const mockGet = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: '<discovery/>',
      headers: { 'set-cookie': [] }
    });
    (client as any).httpClient.get = mockGet;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await client.connect();
    errSpy.mockRestore();
    logSpy.mockRestore();

    expect(result).toBe(false);
  });

  it('fails on network error', async () => {
    const client = new SAPATCClient(mockConnection);

    const mockGet = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));
    (client as any).httpClient.get = mockGet;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await client.connect();
    errSpy.mockRestore();
    logSpy.mockRestore();

    expect(result).toBe(false);
  });

  it('reports 401 authentication failure', async () => {
    const client = new SAPATCClient(mockConnection);

    const error: any = new Error('Request failed');
    error.response = { status: 401 };
    const mockGet = vi.fn().mockRejectedValueOnce(error);
    (client as any).httpClient.get = mockGet;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await client.connect();

    expect(result).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Authentication failed'));
    errSpy.mockRestore();
    logSpy.mockRestore();
  });
});

// ============================================================================
// SAP ATC CLIENT - URL CONSTRUCTION TESTS
// ============================================================================

describe('SAPATCClient - URL construction', () => {
  it('builds HTTP URL with port from host:port', () => {
    const client = new SAPATCClient({
      host: 'myhost.com:8080',
      client: '100',
      username: 'u',
      password: 'p',
      secure: false
    });
    expect((client as any).httpClient.defaults.baseURL).toBe('http://myhost.com:8080');
  });

  it('builds HTTPS URL with port from host:port', () => {
    const client = new SAPATCClient({
      host: 'myhost.com:44300',
      client: '100',
      username: 'u',
      password: 'p',
      secure: true
    });
    expect((client as any).httpClient.defaults.baseURL).toBe('https://myhost.com:44300');
  });

  it('calculates HTTP port from instance number', () => {
    const client = new SAPATCClient({
      host: 'myhost.com',
      instanceNumber: '01',
      client: '100',
      username: 'u',
      password: 'p',
      secure: false
    });
    expect((client as any).httpClient.defaults.baseURL).toBe('http://myhost.com:8001');
  });

  it('calculates HTTPS port from instance number', () => {
    const client = new SAPATCClient({
      host: 'myhost.com',
      instanceNumber: '01',
      client: '100',
      username: 'u',
      password: 'p',
      secure: true
    });
    expect((client as any).httpClient.defaults.baseURL).toBe('https://myhost.com:44301');
  });

  it('uses bare host when no port or instance number', () => {
    const client = new SAPATCClient({
      host: 'myhost.com',
      client: '100',
      username: 'u',
      password: 'p',
      secure: false
    });
    expect((client as any).httpClient.defaults.baseURL).toBe('http://myhost.com');
  });

  it('strips protocol prefix from host', () => {
    const client = new SAPATCClient({
      host: 'https://myhost.com:8080',
      client: '100',
      username: 'u',
      password: 'p',
      secure: true
    });
    expect((client as any).httpClient.defaults.baseURL).toBe('https://myhost.com:8080');
  });

  it('adds sap-client param to URL without query string', () => {
    const client = new SAPATCClient({
      host: 'test:8000',
      client: '001',
      username: 'u',
      password: 'p'
    });
    expect((client as any).addClientParam('/sap/bc/adt/atc/runs')).toBe('/sap/bc/adt/atc/runs?sap-client=001');
  });

  it('adds sap-client param to URL with existing query string', () => {
    const client = new SAPATCClient({
      host: 'test:8000',
      client: '100',
      username: 'u',
      password: 'p'
    });
    expect((client as any).addClientParam('/sap/bc/adt/atc/worklists?checkVariant=DEFAULT')).toBe(
      '/sap/bc/adt/atc/worklists?checkVariant=DEFAULT&sap-client=100'
    );
  });
});

// ============================================================================
// SAP ATC CLIENT - checkObject TESTS
// ============================================================================

describe('SAPATCClient - checkObject', () => {
  const mockConnection = {
    host: 'test.sap.com:50000',
    client: '001',
    username: 'TEST',
    password: 'TEST',
    secure: false
  };

  it('throws if not connected', async () => {
    const client = new SAPATCClient(mockConnection);
    await expect(client.checkObject({ objectName: 'ZCL_TEST' })).rejects.toThrow('Not connected');
  });

  it('returns failed result when object not found', async () => {
    const client = new SAPATCClient(mockConnection);

    // Connect mock
    const mockGet = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: '<d/>', headers: { 'x-csrf-token': 'tok', 'set-cookie': [] } })
      // discoverObjectType - search returns empty
      .mockResolvedValueOnce({
        status: 200,
        data: '<?xml version="1.0"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>'
      })
      // searchForSimilarObjects - 3 wildcard searches
      .mockResolvedValueOnce({
        status: 200,
        data: '<?xml version="1.0"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>'
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '<?xml version="1.0"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>'
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '<?xml version="1.0"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>'
      });

    (client as any).httpClient.get = mockGet;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.connect();
    const result = await client.checkObject({ objectName: 'ZNONEXISTENT' });
    logSpy.mockRestore();

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('not found');
    expect(result.objectType).toBe('UNKNOWN');
  });
});

// ============================================================================
// SAP ATC CLIENT - PRIORITY MAPPING TESTS
// ============================================================================

describe('SAPATCClient - priority to severity mapping', () => {
  it('maps priority 1 to ERROR', () => {
    const client = new SAPATCClient({
      host: 'test:8000',
      client: '001',
      username: 'u',
      password: 'p'
    });
    expect((client as any).mapPriorityToSeverity(1)).toBe('ERROR');
  });

  it('maps priority 2 to WARNING', () => {
    const client = new SAPATCClient({
      host: 'test:8000',
      client: '001',
      username: 'u',
      password: 'p'
    });
    expect((client as any).mapPriorityToSeverity(2)).toBe('WARNING');
  });

  it('maps priority 3 to INFO', () => {
    const client = new SAPATCClient({
      host: 'test:8000',
      client: '001',
      username: 'u',
      password: 'p'
    });
    expect((client as any).mapPriorityToSeverity(3)).toBe('INFO');
  });

  it('maps priority 4 to INFO', () => {
    const client = new SAPATCClient({
      host: 'test:8000',
      client: '001',
      username: 'u',
      password: 'p'
    });
    expect((client as any).mapPriorityToSeverity(4)).toBe('INFO');
  });

  it('maps priority 0 to INFO', () => {
    const client = new SAPATCClient({
      host: 'test:8000',
      client: '001',
      username: 'u',
      password: 'p'
    });
    expect((client as any).mapPriorityToSeverity(0)).toBe('INFO');
  });
});

// ============================================================================
// SAP ATC CLIENT - LINE EXTRACTION TESTS
// ============================================================================

describe('SAPATCClient - extractLineFromLocation', () => {
  const client = new SAPATCClient({
    host: 'test:8000',
    client: '001',
    username: 'u',
    password: 'p'
  });

  it('extracts line from #start=N format', () => {
    expect((client as any).extractLineFromLocation('/source/main#start=42,1')).toBe(42);
  });

  it('extracts line from line=N format', () => {
    expect((client as any).extractLineFromLocation('line=15')).toBe(15);
  });

  it('extracts line from colon format', () => {
    expect((client as any).extractLineFromLocation('file:23:5')).toBe(23);
  });

  it('extracts line from start=N format', () => {
    expect((client as any).extractLineFromLocation('start=99')).toBe(99);
  });

  it('returns undefined for empty location', () => {
    expect((client as any).extractLineFromLocation('')).toBeUndefined();
  });

  it('returns undefined for null location', () => {
    expect((client as any).extractLineFromLocation(null)).toBeUndefined();
  });

  it('returns undefined for location without line info', () => {
    expect((client as any).extractLineFromLocation('/sap/bc/adt/oo/classes/zcl_test')).toBeUndefined();
  });

  it('returns undefined for line 0', () => {
    expect((client as any).extractLineFromLocation('#start=0,1')).toBeUndefined();
  });
});

// ============================================================================
// SAP ATC CLIENT - ITEM ID EXTRACTION TESTS
// ============================================================================

describe('SAPATCClient - extractItemId and extractIndex', () => {
  const client = new SAPATCClient({
    host: 'test:8000',
    client: '001',
    username: 'u',
    password: 'p'
  });

  it('extracts 32-char item ID', () => {
    expect((client as any).extractItemId('/itemid/ABCD1234EFGH5678IJKL9012MNOP3456/index/1')).toBe(
      'ABCD1234EFGH5678IJKL9012MNOP3456'
    );
  });

  it('returns null for malformed item ID', () => {
    expect((client as any).extractItemId('/itemid/SHORT/index/1')).toBeNull();
  });

  it('extracts index number', () => {
    expect((client as any).extractIndex('/itemid/ABCD1234EFGH5678IJKL9012MNOP3456/index/5')).toBe(5);
  });

  it('returns null for missing index', () => {
    expect((client as any).extractIndex('/itemid/ABCD1234EFGH5678IJKL9012MNOP3456')).toBeNull();
  });
});

// ============================================================================
// URL ENCODING TESTS (C1, C2, C3)
// ============================================================================

describe('SAPATCClient - URL encoding', () => {
  const mockConnection = {
    host: 'test.sap.com:50000',
    client: '001',
    username: 'TEST',
    password: 'TEST',
    secure: false
  };

  it('encodes variant name in createATCWorklist URL (C1)', async () => {
    const client = new SAPATCClient(mockConnection);

    // Connect
    const mockGet = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: '<d/>',
      headers: { 'x-csrf-token': 'tok', 'set-cookie': [] }
    });
    (client as any).httpClient.get = mockGet;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.connect();

    // Mock POST for createATCWorklist
    const mockPost = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: 'worklist-id-123'
    });
    (client as any).httpClient.post = mockPost;

    await (client as any).createATCWorklist('VARIANT WITH SPACES');

    const calledUrl = mockPost.mock.calls[0][0];
    expect(calledUrl).toContain('checkVariant=VARIANT%20WITH%20SPACES');
    expect(calledUrl).not.toContain('VARIANT WITH SPACES');

    logSpy.mockRestore();
  });

  it('encodes variant name with special chars (C1)', async () => {
    const client = new SAPATCClient(mockConnection);

    const mockGet = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: '<d/>',
      headers: { 'x-csrf-token': 'tok', 'set-cookie': [] }
    });
    (client as any).httpClient.get = mockGet;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.connect();

    const mockPost = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: 'worklist-id-123'
    });
    (client as any).httpClient.post = mockPost;

    await (client as any).createATCWorklist('A&B=C');

    const calledUrl = mockPost.mock.calls[0][0];
    expect(calledUrl).toContain('checkVariant=A%26B%3DC');

    logSpy.mockRestore();
  });

  it('encodes objectName in buildObjectReferences URI (C2)', () => {
    const client = new SAPATCClient(mockConnection);
    const refs = (client as any).buildObjectReferences('ZCL MY CLASS', 'CLAS/OC');
    expect(refs[0].uri).toContain('zcl%20my%20class');
    expect(refs[0].uri).not.toContain('zcl my class');
  });

  it('encodes worklistId in startATCRun URL (C3)', async () => {
    const client = new SAPATCClient(mockConnection);

    const mockGet = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: '<d/>',
      headers: { 'x-csrf-token': 'tok', 'set-cookie': [] }
    });
    (client as any).httpClient.get = mockGet;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.connect();

    const mockPost = vi.fn().mockResolvedValueOnce({
      status: 201,
      data: '<run/>',
      headers: { location: '/sap/bc/adt/atc/runs/run123' }
    });
    (client as any).httpClient.post = mockPost;

    await (client as any).startATCRun('wl/id+special', [{ uri: '/test' }]);

    const calledUrl = mockPost.mock.calls[0][0];
    expect(calledUrl).toContain('worklistId=wl%2Fid%2Bspecial');

    logSpy.mockRestore();
  });

  it('encodes runId in getATCRunStatus URL (C3)', async () => {
    const client = new SAPATCClient(mockConnection);

    const mockGet = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        data: '<d/>',
        headers: { 'x-csrf-token': 'tok', 'set-cookie': [] }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '<?xml version="1.0"?><runs:run xmlns:runs="http://www.sap.com/adt/atc" runs:status="finished"/>'
      });
    (client as any).httpClient.get = mockGet;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.connect();

    await (client as any).getATCRunStatus('run/id+special');

    const statusUrl = mockGet.mock.calls[1][0];
    expect(statusUrl).toContain('/atc/runs/run%2Fid%2Bspecial');

    logSpy.mockRestore();
  });

  it('encodes worklistId in getATCWorklist URL (C3)', async () => {
    const client = new SAPATCClient(mockConnection);

    const mockGet = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        data: '<d/>',
        headers: { 'x-csrf-token': 'tok', 'set-cookie': [] }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '<?xml version="1.0"?><atcworklist:worklist xmlns:atcworklist="http://www.sap.com/adt/atc/worklist" atcworklist:id="wl1" atcworklist:timestamp="2024-01-01"/>'
      });
    (client as any).httpClient.get = mockGet;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.connect();

    await (client as any).getATCWorklist('wl/special', false);

    const wlUrl = mockGet.mock.calls[1][0];
    expect(wlUrl).toContain('/atc/worklists/wl%2Fspecial');

    logSpy.mockRestore();
  });
});

// ============================================================================
// WORKLIST PARSING TESTS (P1)
// ============================================================================

describe('SAPATCClient - parseATCWorklist', () => {
  const client = new SAPATCClient({
    host: 'test:8000',
    client: '001',
    username: 'u',
    password: 'p'
  });

  it('parses a realistic SAP worklist with findings', async () => {
    const { parseString } = await import('xml2js');
    const { promisify } = await import('util');
    const parseXML = promisify(parseString);

    const worklistXml = `<?xml version="1.0" encoding="utf-8"?>
      <atcworklist:worklist xmlns:atcworklist="http://www.sap.com/adt/atc/worklist"
                            xmlns:atcobject="http://www.sap.com/adt/atc/object"
                            xmlns:atcfinding="http://www.sap.com/adt/atc/finding"
                            xmlns:adtcore="http://www.sap.com/adt/core"
                            xmlns:atom="http://www.w3.org/2005/Atom"
                            atcworklist:id="wl123"
                            atcworklist:timestamp="2024-01-15T10:30:00Z">
        <atcworklist:objects>
          <atcobject:object adtcore:uri="/sap/bc/adt/oo/classes/zcl_test"
                           adtcore:type="CLAS/OC"
                           adtcore:name="ZCL_TEST"
                           adtcore:packageName="ZPACKAGE">
            <atcobject:findings>
              <atcfinding:finding adtcore:uri="/sap/bc/adt/atc/findings/1"
                                  atcfinding:location="/source/main#start=42,1"
                                  atcfinding:priority="1"
                                  atcfinding:checkId="CL_CI_TEST_AMDP"
                                  atcfinding:checkTitle="AMDP Check"
                                  atcfinding:messageId="MSG001"
                                  atcfinding:messageTitle="Use of non-released API"
                                  atcfinding:quickfixInfo="Fix available">
                <atcfinding:quickfixes atcfinding:manual="false" atcfinding:automatic="true" atcfinding:pseudo="false"/>
              </atcfinding:finding>
              <atcfinding:finding adtcore:uri="/sap/bc/adt/atc/findings/2"
                                  atcfinding:location="/source/main#start=100,5"
                                  atcfinding:priority="3"
                                  atcfinding:checkId="CL_CI_TEST_NAMING"
                                  atcfinding:checkTitle="Naming Convention"
                                  atcfinding:messageId="MSG002"
                                  atcfinding:messageTitle="Variable naming convention violated"
                                  atcfinding:quickfixInfo="">
              </atcfinding:finding>
            </atcobject:findings>
          </atcobject:object>
        </atcworklist:objects>
      </atcworklist:worklist>`;

    const parsed = await parseXML(worklistXml);
    const worklist = (client as any).parseATCWorklist(parsed);

    expect(worklist.id).toBe('wl123');
    expect(worklist.timestamp).toBe('2024-01-15T10:30:00Z');
    expect(worklist.objects).toHaveLength(1);

    const obj = worklist.objects[0];
    expect(obj.name).toBe('ZCL_TEST');
    expect(obj.type).toBe('CLAS/OC');
    expect(obj.packageName).toBe('ZPACKAGE');
    expect(obj.findings).toHaveLength(2);

    const finding1 = obj.findings[0];
    expect(finding1.priority).toBe(1);
    expect(finding1.checkId).toBe('CL_CI_TEST_AMDP');
    expect(finding1.messageTitle).toBe('Use of non-released API');
    expect(finding1.location).toBe('/source/main#start=42,1');
    expect(finding1.quickfixAutomatic).toBe(true);
    expect(finding1.quickfixManual).toBe(false);

    const finding2 = obj.findings[1];
    expect(finding2.priority).toBe(3);
    expect(finding2.checkId).toBe('CL_CI_TEST_NAMING');
  });

  it('parses empty worklist (no objects)', async () => {
    const { parseString } = await import('xml2js');
    const { promisify } = await import('util');
    const parseXML = promisify(parseString);

    const emptyXml = `<?xml version="1.0" encoding="utf-8"?>
      <atcworklist:worklist xmlns:atcworklist="http://www.sap.com/adt/atc/worklist"
                            atcworklist:id="wl456"
                            atcworklist:timestamp="2024-01-15T11:00:00Z">
        <atcworklist:objects/>
      </atcworklist:worklist>`;

    const parsed = await parseXML(emptyXml);
    const worklist = (client as any).parseATCWorklist(parsed);

    expect(worklist.id).toBe('wl456');
    expect(worklist.objects).toHaveLength(0);
  });

  it('parses worklist with multiple objects', async () => {
    const { parseString } = await import('xml2js');
    const { promisify } = await import('util');
    const parseXML = promisify(parseString);

    const multiXml = `<?xml version="1.0" encoding="utf-8"?>
      <atcworklist:worklist xmlns:atcworklist="http://www.sap.com/adt/atc/worklist"
                            xmlns:atcobject="http://www.sap.com/adt/atc/object"
                            xmlns:atcfinding="http://www.sap.com/adt/atc/finding"
                            xmlns:adtcore="http://www.sap.com/adt/core"
                            atcworklist:id="wl789"
                            atcworklist:timestamp="2024-01-15T12:00:00Z">
        <atcworklist:objects>
          <atcobject:object adtcore:uri="/sap/bc/adt/oo/classes/zcl_a"
                           adtcore:type="CLAS/OC"
                           adtcore:name="ZCL_A"
                           adtcore:packageName="ZPKG">
            <atcobject:findings>
              <atcfinding:finding adtcore:uri="/f1"
                                  atcfinding:location="#start=10,1"
                                  atcfinding:priority="2"
                                  atcfinding:checkId="CHECK1"
                                  atcfinding:checkTitle="Check 1"
                                  atcfinding:messageId="M1"
                                  atcfinding:messageTitle="Warning message"
                                  atcfinding:quickfixInfo=""/>
            </atcobject:findings>
          </atcobject:object>
          <atcobject:object adtcore:uri="/sap/bc/adt/programs/programs/zprog"
                           adtcore:type="PROG/P"
                           adtcore:name="ZPROG"
                           adtcore:packageName="ZPKG">
            <atcobject:findings>
              <atcfinding:finding adtcore:uri="/f2"
                                  atcfinding:location="#start=5,1"
                                  atcfinding:priority="1"
                                  atcfinding:checkId="CHECK2"
                                  atcfinding:checkTitle="Check 2"
                                  atcfinding:messageId="M2"
                                  atcfinding:messageTitle="Error message"
                                  atcfinding:quickfixInfo=""/>
            </atcobject:findings>
          </atcobject:object>
        </atcworklist:objects>
      </atcworklist:worklist>`;

    const parsed = await parseXML(multiXml);
    const worklist = (client as any).parseATCWorklist(parsed);

    expect(worklist.objects).toHaveLength(2);
    expect(worklist.objects[0].name).toBe('ZCL_A');
    expect(worklist.objects[1].name).toBe('ZPROG');
    expect(worklist.objects[0].findings[0].priority).toBe(2);
    expect(worklist.objects[1].findings[0].priority).toBe(1);
  });
});

// ============================================================================
// CONVERT WORKLIST TO RESULTS TESTS (P2)
// ============================================================================

describe('SAPATCClient - convertWorklistToResults', () => {
  const client = new SAPATCClient({
    host: 'test:8000',
    client: '001',
    username: 'u',
    password: 'p'
  });

  it('converts worklist findings to ATCResult array', () => {
    const worklist = {
      id: 'wl1',
      timestamp: '2024-01-01',
      objects: [
        {
          uri: '/test',
          type: 'CLAS/OC',
          name: 'ZCL_TEST',
          packageName: 'ZPKG',
          findings: [
            {
              uri: '/f1',
              location: '/source/main#start=42,1',
              priority: 1,
              checkId: 'CHECK_API',
              checkTitle: 'API Usage Check',
              messageId: 'MSG001',
              messageTitle: 'Use of non-released API CL_OLD_API',
              quickfixInfo: 'Replace with CL_NEW_API',
              quickfixAutomatic: true,
              quickfixManual: false,
              quickfixPseudo: false,
              tags: []
            }
          ]
        }
      ]
    };

    const results = (client as any).convertWorklistToResults(worklist);

    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('ERROR');
    expect(results[0].message).toBe('Use of non-released API CL_OLD_API');
    expect(results[0].line).toBe(42);
    expect(results[0].checkId).toBe('CHECK_API');
    expect(results[0].priority).toBe('1');
    expect(results[0].quickfixAvailable).toBe(true);
    expect(results[0].quickfixType).toBe('automatic');
    expect(results[0].quickfixInfo).toBe('Replace with CL_NEW_API');
  });

  it('maps priority 2 to WARNING severity', () => {
    const worklist = {
      id: 'wl1',
      timestamp: '2024-01-01',
      objects: [
        {
          uri: '/test',
          type: 'CLAS/OC',
          name: 'ZCL_TEST',
          packageName: 'ZPKG',
          findings: [
            {
              uri: '/f1',
              location: '#start=10,1',
              priority: 2,
              checkId: 'CHECK_NAMING',
              checkTitle: 'Naming Convention',
              messageId: 'M1',
              messageTitle: 'Naming violation',
              quickfixInfo: '',
              tags: []
            }
          ]
        }
      ]
    };

    const results = (client as any).convertWorklistToResults(worklist);
    expect(results[0].severity).toBe('WARNING');
    expect(results[0].priority).toBe('2');
  });

  it('maps priority 3+ to INFO severity', () => {
    const worklist = {
      id: 'wl1',
      timestamp: '2024-01-01',
      objects: [
        {
          uri: '/test',
          type: 'PROG/P',
          name: 'ZTEST',
          packageName: 'ZPKG',
          findings: [
            {
              uri: '/f1',
              location: '',
              priority: 3,
              checkId: 'CHECK_INFO',
              checkTitle: 'Info Check',
              messageId: 'M1',
              messageTitle: 'Info message',
              quickfixInfo: '',
              tags: []
            },
            {
              uri: '/f2',
              location: '',
              priority: 4,
              checkId: 'CHECK_LOW',
              checkTitle: 'Low Check',
              messageId: 'M2',
              messageTitle: 'Low priority',
              quickfixInfo: '',
              tags: []
            }
          ]
        }
      ]
    };

    const results = (client as any).convertWorklistToResults(worklist);
    expect(results).toHaveLength(2);
    expect(results[0].severity).toBe('INFO');
    expect(results[1].severity).toBe('INFO');
  });

  it('detects manual quickfix type', () => {
    const worklist = {
      id: 'wl1',
      timestamp: '2024-01-01',
      objects: [
        {
          uri: '/test',
          type: 'CLAS/OC',
          name: 'ZCL_TEST',
          packageName: 'ZPKG',
          findings: [
            {
              uri: '/f1',
              location: '',
              priority: 2,
              checkId: 'C1',
              checkTitle: 'T1',
              messageId: 'M1',
              messageTitle: 'Msg',
              quickfixInfo: '',
              quickfixManual: true,
              quickfixAutomatic: false,
              quickfixPseudo: false,
              tags: []
            }
          ]
        }
      ]
    };

    const results = (client as any).convertWorklistToResults(worklist);
    expect(results[0].quickfixAvailable).toBe(true);
    expect(results[0].quickfixType).toBe('manual');
  });

  it('detects pseudo quickfix type', () => {
    const worklist = {
      id: 'wl1',
      timestamp: '2024-01-01',
      objects: [
        {
          uri: '/test',
          type: 'CLAS/OC',
          name: 'ZCL_TEST',
          packageName: 'ZPKG',
          findings: [
            {
              uri: '/f1',
              location: '',
              priority: 2,
              checkId: 'C1',
              checkTitle: 'T1',
              messageId: 'M1',
              messageTitle: 'Msg',
              quickfixInfo: '',
              quickfixManual: false,
              quickfixAutomatic: false,
              quickfixPseudo: true,
              tags: []
            }
          ]
        }
      ]
    };

    const results = (client as any).convertWorklistToResults(worklist);
    expect(results[0].quickfixAvailable).toBe(true);
    expect(results[0].quickfixType).toBe('pseudo');
  });

  it('reports no quickfix when none available', () => {
    const worklist = {
      id: 'wl1',
      timestamp: '2024-01-01',
      objects: [
        {
          uri: '/test',
          type: 'CLAS/OC',
          name: 'ZCL_TEST',
          packageName: 'ZPKG',
          findings: [
            {
              uri: '/f1',
              location: '',
              priority: 1,
              checkId: 'C1',
              checkTitle: 'T1',
              messageId: 'M1',
              messageTitle: 'Msg',
              quickfixInfo: '',
              tags: []
            }
          ]
        }
      ]
    };

    const results = (client as any).convertWorklistToResults(worklist);
    expect(results[0].quickfixAvailable).toBe(false);
    expect(results[0].quickfixType).toBe('none');
  });

  it('returns empty array for empty worklist', () => {
    const worklist = { id: 'wl1', timestamp: '2024-01-01', objects: [] };
    const results = (client as any).convertWorklistToResults(worklist);
    expect(results).toHaveLength(0);
  });

  it('aggregates findings from multiple objects', () => {
    const worklist = {
      id: 'wl1',
      timestamp: '2024-01-01',
      objects: [
        {
          uri: '/a',
          type: 'CLAS/OC',
          name: 'ZCL_A',
          packageName: 'ZPKG',
          findings: [
            {
              uri: '/f1',
              location: '',
              priority: 1,
              checkId: 'C1',
              checkTitle: 'T1',
              messageId: 'M1',
              messageTitle: 'Msg1',
              quickfixInfo: '',
              tags: []
            }
          ]
        },
        {
          uri: '/b',
          type: 'PROG/P',
          name: 'ZPROG',
          packageName: 'ZPKG',
          findings: [
            {
              uri: '/f2',
              location: '',
              priority: 2,
              checkId: 'C2',
              checkTitle: 'T2',
              messageId: 'M2',
              messageTitle: 'Msg2',
              quickfixInfo: '',
              tags: []
            },
            {
              uri: '/f3',
              location: '',
              priority: 3,
              checkId: 'C3',
              checkTitle: 'T3',
              messageId: 'M3',
              messageTitle: 'Msg3',
              quickfixInfo: '',
              tags: []
            }
          ]
        }
      ]
    };

    const results = (client as any).convertWorklistToResults(worklist);
    expect(results).toHaveLength(3);
    expect(results[0].severity).toBe('ERROR');
    expect(results[1].severity).toBe('WARNING');
    expect(results[2].severity).toBe('INFO');
  });
});

// ============================================================================
// FULL HAPPY-PATH INTEGRATION TEST (P3)
// ============================================================================

describe('SAPATCClient - runATCCheck happy path', () => {
  const mockConnection = {
    host: 'test.sap.com:50000',
    client: '001',
    username: 'TEST',
    password: 'TEST',
    secure: false
  };

  it('executes full 5-step ATC workflow and returns findings', async () => {
    const client = new SAPATCClient(mockConnection);

    // Step 0: Connect
    const connectResponse = {
      status: 200,
      data: '<discovery/>',
      headers: { 'x-csrf-token': 'csrf-tok-123', 'set-cookie': ['sid=abc'] }
    };

    // Step 4: Get worklist results
    const worklistResultXml = `<?xml version="1.0" encoding="utf-8"?>
      <atcworklist:worklist xmlns:atcworklist="http://www.sap.com/adt/atc/worklist"
                            xmlns:atcobject="http://www.sap.com/adt/atc/object"
                            xmlns:atcfinding="http://www.sap.com/adt/atc/finding"
                            xmlns:adtcore="http://www.sap.com/adt/core"
                            atcworklist:id="WL001"
                            atcworklist:timestamp="2024-01-15T10:30:00Z">
        <atcworklist:objects>
          <atcobject:object adtcore:uri="/sap/bc/adt/oo/classes/zcl_test"
                           adtcore:type="CLAS/OC"
                           adtcore:name="ZCL_TEST"
                           adtcore:packageName="ZPACKAGE">
            <atcobject:findings>
              <atcfinding:finding adtcore:uri="/sap/bc/adt/atc/findings/1"
                                  atcfinding:location="/source/main#start=42,1"
                                  atcfinding:priority="1"
                                  atcfinding:checkId="CL_CI_TEST_API"
                                  atcfinding:checkTitle="API Usage"
                                  atcfinding:messageId="MSG001"
                                  atcfinding:messageTitle="Non-released API used"
                                  atcfinding:quickfixInfo="Replace API">
                <atcfinding:quickfixes atcfinding:manual="false" atcfinding:automatic="true" atcfinding:pseudo="false"/>
              </atcfinding:finding>
            </atcobject:findings>
          </atcobject:object>
        </atcworklist:objects>
      </atcworklist:worklist>`;

    // Step 3: Poll status (finished immediately)
    const runStatusXml = `<?xml version="1.0"?>
      <runs:run xmlns:runs="http://www.sap.com/adt/atc" runs:status="finished"/>`;

    const mockGet = vi
      .fn()
      // connect
      .mockResolvedValueOnce(connectResponse)
      // getATCRunStatus (poll)
      .mockResolvedValueOnce({ status: 200, data: runStatusXml })
      // getATCWorklist
      .mockResolvedValueOnce({ status: 200, data: worklistResultXml });

    const mockPost = vi
      .fn()
      // Step 1: createATCWorklist
      .mockResolvedValueOnce({ status: 200, data: 'WL001' })
      // Step 2: startATCRun
      .mockResolvedValueOnce({
        status: 201,
        data: '<run/>',
        headers: { location: '/sap/bc/adt/atc/runs/RUN001' }
      });

    (client as any).httpClient.get = mockGet;
    (client as any).httpClient.post = mockPost;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await client.connect();

    const results = await client.runATCCheck('ZCL_TEST', 'CLAS/OC', 'CLEAN_CORE', false);

    logSpy.mockRestore();
    errSpy.mockRestore();

    // Verify results
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('ERROR');
    expect(results[0].message).toBe('Non-released API used');
    expect(results[0].line).toBe(42);
    expect(results[0].checkId).toBe('CL_CI_TEST_API');
    expect(results[0].quickfixAvailable).toBe(true);
    expect(results[0].quickfixType).toBe('automatic');

    // Verify the 5-step workflow was followed
    // POST 1: createATCWorklist
    expect(mockPost.mock.calls[0][0]).toContain('/atc/worklists');
    expect(mockPost.mock.calls[0][0]).toContain('checkVariant=CLEAN_CORE');
    // POST 2: startATCRun
    expect(mockPost.mock.calls[1][0]).toContain('/atc/runs');
    expect(mockPost.mock.calls[1][0]).toContain('worklistId=WL001');
    // GET 1: getATCRunStatus
    expect(mockGet.mock.calls[1][0]).toContain('/atc/runs/RUN001');
    // GET 2: getATCWorklist
    expect(mockGet.mock.calls[2][0]).toContain('/atc/worklists/WL001');
  });

  it('returns empty results for clean object (no findings)', async () => {
    const client = new SAPATCClient(mockConnection);

    const emptyWorklistXml = `<?xml version="1.0"?>
      <atcworklist:worklist xmlns:atcworklist="http://www.sap.com/adt/atc/worklist"
                            atcworklist:id="WL002"
                            atcworklist:timestamp="2024-01-15">
        <atcworklist:objects/>
      </atcworklist:worklist>`;

    const runStatusXml = `<?xml version="1.0"?>
      <runs:run xmlns:runs="http://www.sap.com/adt/atc" runs:status="finished"/>`;

    const mockGet = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: '<d/>', headers: { 'x-csrf-token': 'tok', 'set-cookie': [] } })
      .mockResolvedValueOnce({ status: 200, data: runStatusXml })
      .mockResolvedValueOnce({ status: 200, data: emptyWorklistXml });

    const mockPost = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: 'WL002' })
      .mockResolvedValueOnce({ status: 201, data: '', headers: { location: '/atc/runs/RUN002' } });

    (client as any).httpClient.get = mockGet;
    (client as any).httpClient.post = mockPost;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.connect();
    const results = await client.runATCCheck('ZCL_CLEAN', 'CLAS/OC', 'DEFAULT', false);
    logSpy.mockRestore();

    expect(results).toHaveLength(0);
  });
});

// ============================================================================
// API BOUNDARY VALIDATION TEST (P5)
// ============================================================================

describe('SAPATCClient - API input validation', () => {
  const mockConnection = {
    host: 'test.sap.com:50000',
    client: '001',
    username: 'TEST',
    password: 'TEST',
    secure: false
  };

  it('validates objectName in checkObject', async () => {
    const client = new SAPATCClient(mockConnection);

    // Connect
    const mockGet = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: '<d/>',
      headers: { 'x-csrf-token': 'tok', 'set-cookie': [] }
    });
    (client as any).httpClient.get = mockGet;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.connect();

    const result = await client.checkObject({ objectName: '<script>alert(1)</script>' });
    logSpy.mockRestore();

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('Invalid object name');
  });

  it('validates objectName in runATCCheck', async () => {
    const client = new SAPATCClient(mockConnection);

    const mockGet = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: '<d/>',
      headers: { 'x-csrf-token': 'tok', 'set-cookie': [] }
    });
    (client as any).httpClient.get = mockGet;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await client.connect();

    const results = await client.runATCCheck('ZCL&EVIL', 'CLAS/OC', 'DEFAULT', false);
    logSpy.mockRestore();
    errSpy.mockRestore();

    expect(results).toHaveLength(0);
  });
});
