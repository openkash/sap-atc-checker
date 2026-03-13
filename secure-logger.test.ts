import { describe, it, expect } from 'vitest';
import { SecureLogger } from './secure-logger.js';

// ============================================================================
// SecureLogger - SENSITIVE DATA MASKING TESTS (P4)
// ============================================================================

describe('SecureLogger - maskSensitiveData', () => {
  // Access private method for direct testing
  const mask = (data: any) => (SecureLogger as any).maskSensitiveData(data);

  it('masks password fields', () => {
    const result = mask({ password: 'secret123' });
    expect(result.password).toBe('***REDACTED***');
  });

  it('masks PASSWORD (case-insensitive)', () => {
    const result = mask({ PASSWORD: 'secret123' });
    expect(result.PASSWORD).toBe('***REDACTED***');
  });

  it('masks fields containing "password" substring', () => {
    const result = mask({ userPassword: 'secret', oldPassword: 'old' });
    expect(result.userPassword).toBe('***REDACTED***');
    expect(result.oldPassword).toBe('***REDACTED***');
  });

  it('masks passwd and pwd fields', () => {
    const result = mask({ passwd: 'secret', pwd: 'secret' });
    expect(result.passwd).toBe('***REDACTED***');
    expect(result.pwd).toBe('***REDACTED***');
  });

  it('masks authorization fields', () => {
    const result = mask({ authorization: 'Basic abc123' });
    expect(result.authorization).toBe('***REDACTED***');
  });

  it('masks token fields', () => {
    const result = mask({ 'x-csrf-token': 'tok123', accessToken: 'bearer-xyz' });
    expect(result['x-csrf-token']).toBe('***REDACTED***');
    expect(result.accessToken).toBe('***REDACTED***');
  });

  it('masks auth fields', () => {
    const result = mask({ authHeader: 'Basic abc' });
    expect(result.authHeader).toBe('***REDACTED***');
  });

  it('partially masks username fields', () => {
    const result = mask({ username: 'ADMIN_USER' });
    expect(result.username).toBe('AD***');
  });

  it('masks short usernames (2 chars or less) completely', () => {
    const result = mask({ username: 'AB' });
    expect(result.username).toBe('***');
  });

  it('masks single-char usernames', () => {
    const result = mask({ user: 'A' });
    expect(result.user).toBe('***');
  });

  it('sanitizes file paths with /home/', () => {
    const result = mask({ path: '/home/john/projects/sap' });
    expect(result.path).toBe('/home/***/projects/sap');
  });

  it('sanitizes Windows paths', () => {
    const result = mask({ path: 'C:\\Users\\john\\documents' });
    expect(result.path).toBe('C:\\Users\\***\\documents');
  });

  it('recursively masks nested objects', () => {
    const result = mask({
      connection: {
        host: 'sap.example.com',
        password: 'secret',
        auth: { token: 'abc' }
      }
    });
    expect(result.connection.host).toBe('sap.example.com');
    expect(result.connection.password).toBe('***REDACTED***');
    expect(result.connection.auth).toBe('***REDACTED***');
  });

  it('masks arrays recursively', () => {
    const result = mask([{ password: 'a' }, { password: 'b' }]);
    expect(result[0].password).toBe('***REDACTED***');
    expect(result[1].password).toBe('***REDACTED***');
  });

  it('handles null input', () => {
    expect(mask(null)).toBeNull();
  });

  it('handles undefined input', () => {
    expect(mask(undefined)).toBeUndefined();
  });

  it('returns primitives unchanged', () => {
    expect(mask('hello')).toBe('hello');
    expect(mask(42)).toBe(42);
    expect(mask(true)).toBe(true);
  });

  it('handles Error objects', () => {
    const error = new Error('password=secret123 failed');
    const result = mask(error);
    expect(result.message).toContain('***REDACTED***');
    expect(result.message).not.toContain('secret123');
  });

  it('preserves non-sensitive fields', () => {
    const result = mask({ host: 'sap.example.com', client: '100', objectName: 'ZCL_TEST' });
    expect(result.host).toBe('sap.example.com');
    expect(result.client).toBe('100');
    expect(result.objectName).toBe('ZCL_TEST');
  });
});

// ============================================================================
// SecureLogger - SANITIZE ERROR MESSAGE TESTS
// ============================================================================

describe('SecureLogger - sanitizeErrorMessage', () => {
  const sanitize = (msg: string) => (SecureLogger as any).sanitizeErrorMessage(msg);

  it('redacts password= patterns', () => {
    expect(sanitize('failed password=secret123 in request')).toContain('***REDACTED***');
    expect(sanitize('failed password=secret123 in request')).not.toContain('secret123');
  });

  it('redacts token= patterns', () => {
    expect(sanitize('token=abc123def')).toContain('***REDACTED***');
    expect(sanitize('token=abc123def')).not.toContain('abc123def');
  });

  it('redacts authorization= patterns', () => {
    expect(sanitize('authorization=Basic abc')).toContain('***REDACTED***');
  });

  it('leaves normal messages unchanged', () => {
    expect(sanitize('Connection failed: ECONNREFUSED')).toBe('Connection failed: ECONNREFUSED');
  });
});

// ============================================================================
// SecureLogger - SANITIZE PATH TESTS
// ============================================================================

describe('SecureLogger - sanitizePath', () => {
  const sanitizePath = (p: string) => (SecureLogger as any).sanitizePath(p);

  it('masks Linux home directory', () => {
    expect(sanitizePath('/home/developer/project')).toBe('/home/***/project');
  });

  it('masks Windows home directory', () => {
    expect(sanitizePath('C:\\Users\\developer\\project')).toBe('C:\\Users\\***\\project');
  });

  it('leaves paths without home dirs unchanged', () => {
    expect(sanitizePath('/var/log/sap.log')).toBe('/var/log/sap.log');
  });
});
