import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

/**
 * Secure Logger with automatic sensitive data masking
 *
 * Features:
 * - Masks passwords, credentials, and sensitive paths
 * - Dual output: console + optional file logging
 * - Skill-specific log files: {skill}-{context}-{timestamp}.log
 * - Configurable via LOG_TO_FILE environment variable
 * - Color-coded console output
 * - Support for verbose/debug mode
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

interface LogConfig {
  logToFile: boolean;
  logDir: string;
  skillName: string;
  contextName: string;
  verbose: boolean;
  quiet: boolean;
}

export class SecureLogger {
  private static config: LogConfig = {
    logToFile: process.env.LOG_TO_FILE === 'true',
    logDir: 'logs',
    skillName: 'atc',
    contextName: '',
    verbose: false,
    quiet: false
  };

  private static executionMarkerWritten = false;
  private static currentLogFile: string | null = null;

  /**
   * Initialize logger with configuration
   */
  static configure(options: Partial<LogConfig> = {}): void {
    SecureLogger.config = { ...SecureLogger.config, ...options };

    if (SecureLogger.config.logToFile) {
      SecureLogger.ensureLogDirectory();
      SecureLogger.currentLogFile = SecureLogger.generateLogFilePath();
    }
  }

  /**
   * Set context name (e.g., package name) for log file naming
   */
  static setContext(contextName: string): void {
    SecureLogger.config.contextName = contextName;
    if (SecureLogger.config.logToFile) {
      SecureLogger.currentLogFile = SecureLogger.generateLogFilePath();
    }
  }

  /**
   * Set verbose mode (enables debug logs)
   */
  static setVerbose(verbose: boolean): void {
    SecureLogger.config.verbose = verbose;
  }

  /**
   * Set quiet mode (suppresses info logs)
   */
  static setQuiet(quiet: boolean): void {
    SecureLogger.config.quiet = quiet;
  }

  /**
   * Log info message
   */
  static info(message: string, data?: any): void {
    if (SecureLogger.config.quiet) return;
    SecureLogger.log(LogLevel.INFO, message, data);
  }

  /**
   * Log warning message
   */
  static warn(message: string, data?: any): void {
    SecureLogger.log(LogLevel.WARN, message, data);
  }

  /**
   * Log error message
   */
  static error(message: string, error?: Error | any): void {
    SecureLogger.log(LogLevel.ERROR, message, error);
  }

  /**
   * Log debug message (only shown in verbose mode)
   */
  static debug(message: string, data?: any): void {
    if (!SecureLogger.config.verbose) return;
    SecureLogger.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Write execution separator (once per execution)
   */
  static writeExecutionStart(context: string): void {
    if (SecureLogger.executionMarkerWritten) return;

    const separator = '='.repeat(80);
    const timestamp = new Date().toISOString();
    const header = `NEW EXECUTION: ${context}`;

    const consoleMessage = `\n${separator}\n${header}\nStarted: ${timestamp}\n${separator}\n`;
    console.log(consoleMessage);

    if (SecureLogger.config.logToFile) {
      SecureLogger.writeToFile(`\n${separator}\n${header}\nStarted: ${timestamp}\n${separator}\n`);
    }

    SecureLogger.executionMarkerWritten = true;
  }

  /**
   * Core logging method
   */
  private static log(level: LogLevel, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];

    // Mask sensitive data
    const maskedData = data ? SecureLogger.maskSensitiveData(data) : undefined;

    // Format log entry
    const logEntry = SecureLogger.formatLogEntry(timestamp, levelName, message, maskedData);

    // Console output with colors
    SecureLogger.writeToConsole(level, logEntry);

    // File output (if enabled)
    if (SecureLogger.config.logToFile) {
      SecureLogger.writeToFile(logEntry);
    }
  }

  /**
   * Format log entry
   */
  private static formatLogEntry(timestamp: string, level: string, message: string, data?: any): string {
    let entry = `[${timestamp}] [${level}] ${message}`;

    if (data !== undefined) {
      if (data instanceof Error) {
        entry += `\n  Error: ${data.message}`;
        if (data.stack && SecureLogger.config.verbose) {
          const sanitizedStack = SecureLogger.sanitizeStack(data.stack);
          entry += `\n  Stack: ${sanitizedStack}`;
        }
      } else if (typeof data === 'object') {
        entry += `\n  Data: ${JSON.stringify(data, null, 2)}`;
      } else {
        entry += ` ${data}`;
      }
    }

    return entry + '\n';
  }

  /**
   * Write to console with color coding
   */
  private static writeToConsole(level: LogLevel, message: string): void {
    // Remove timestamp for console (less verbose)
    const consoleMessage = message.replace(/^\[.*?\] /, '');

    switch (level) {
      case LogLevel.DEBUG:
        console.log(`\x1b[90m${consoleMessage}\x1b[0m`); // Gray
        break;
      case LogLevel.INFO:
        console.log(consoleMessage); // Default
        break;
      case LogLevel.WARN:
        console.warn(`\x1b[33m${consoleMessage}\x1b[0m`); // Yellow
        break;
      case LogLevel.ERROR:
        console.error(`\x1b[31m${consoleMessage}\x1b[0m`); // Red
        break;
    }
  }

  /**
   * Write to log file
   */
  private static writeToFile(message: string): void {
    try {
      const logFile = SecureLogger.getLogFilePath();
      appendFileSync(logFile, message, 'utf8');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * Mask sensitive data
   */
  private static maskSensitiveData(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    // Handle primitives
    if (typeof data !== 'object') {
      return data;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      return data.map(item => SecureLogger.maskSensitiveData(item));
    }

    // Handle Error objects
    if (data instanceof Error) {
      return {
        name: data.name,
        message: SecureLogger.sanitizeErrorMessage(data.message),
        stack: data.stack ? SecureLogger.sanitizeStack(data.stack) : undefined
      };
    }

    // Handle objects
    const masked: any = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      // Mask passwords
      if (lowerKey.includes('password') || lowerKey.includes('passwd') || lowerKey === 'pwd') {
        masked[key] = '***REDACTED***';
      }
      // Mask authorization headers/tokens
      else if (lowerKey.includes('authorization') || lowerKey.includes('auth') || lowerKey.includes('token')) {
        masked[key] = '***REDACTED***';
      }
      // Partially mask usernames
      else if (lowerKey.includes('username') || lowerKey === 'user') {
        masked[key] = typeof value === 'string' && value.length > 2 ? `${value.substring(0, 2)}***` : '***';
      }
      // Sanitize file paths
      else if (typeof value === 'string' && (value.includes('/home/') || value.includes('\\Users\\'))) {
        masked[key] = SecureLogger.sanitizePath(value);
      }
      // Recursively mask nested objects
      else if (typeof value === 'object') {
        masked[key] = SecureLogger.maskSensitiveData(value);
      }
      // Keep other values as-is
      else {
        masked[key] = value;
      }
    }

    return masked;
  }

  /**
   * Sanitize file paths (mask home directories)
   */
  private static sanitizePath(path: string): string {
    return path
      .replace(/\/home\/[^/]+/g, '/home/***')
      .replace(/\\Users\\[^\\]+/g, '\\Users\\***')
      .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\***');
  }

  /**
   * Sanitize stack traces
   */
  private static sanitizeStack(stack: string): string {
    return stack
      .split('\n')
      .map(line => SecureLogger.sanitizePath(line))
      .join('\n');
  }

  /**
   * Sanitize error messages
   */
  private static sanitizeErrorMessage(message: string): string {
    // Remove potential credential leaks in error messages
    return message
      .replace(/password[=:]\s*\S+/gi, 'password=***REDACTED***')
      .replace(/token[=:]\s*\S+/gi, 'token=***REDACTED***')
      .replace(/authorization[=:]\s*\S+/gi, 'authorization=***REDACTED***');
  }

  /**
   * Ensure log directory exists
   */
  private static ensureLogDirectory(): void {
    const logDir = SecureLogger.config.logDir;
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Generate log file path: {skill}-{context}-{timestamp}.log
   */
  private static generateLogFilePath(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const skill = SecureLogger.config.skillName;
    const context = SecureLogger.config.contextName || 'session';
    return join(SecureLogger.config.logDir, `${skill}-${context}-${timestamp}.log`);
  }

  /**
   * Get current log file path
   */
  private static getLogFilePath(): string {
    if (!SecureLogger.currentLogFile) {
      SecureLogger.currentLogFile = SecureLogger.generateLogFilePath();
    }
    return SecureLogger.currentLogFile;
  }
}
