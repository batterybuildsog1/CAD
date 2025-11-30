/**
 * Console Interceptor for Antigravity CAD
 *
 * Captures console.log, console.warn, console.error output
 * and logs it through the structured logging system.
 */

import { getClientLogger } from './client-logger';
import type { LogLevel } from './types';

type ConsoleMethod = 'log' | 'warn' | 'error' | 'info' | 'debug';

interface OriginalConsoleMethods {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
  info: typeof console.info;
  debug: typeof console.debug;
}

let isInstalled = false;
let originalMethods: OriginalConsoleMethods | null = null;

/** Map console method to log level */
const METHOD_TO_LEVEL: Record<ConsoleMethod, LogLevel> = {
  log: 'info',
  info: 'info',
  debug: 'debug',
  warn: 'warn',
  error: 'error',
};

/** Serialize console arguments to string */
function serializeArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

/** Extract error from arguments if present */
function extractError(args: unknown[]): Error | undefined {
  for (const arg of args) {
    if (arg instanceof Error) {
      return arg;
    }
  }
  return undefined;
}

/** Check if the log is from our own logger (prevent recursion) */
function isFromLogger(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const first = args[0];
  if (typeof first === 'string') {
    // Our logger prefixes with [category:event] or [SERVER:...]
    return first.startsWith('[') && (first.includes(':') || first.includes('SERVER'));
  }
  return false;
}

/**
 * Install console interceptor.
 * Captures all console output and logs it to the structured logging system.
 * Safe to call multiple times - will only install once.
 */
export function installConsoleInterceptor(): void {
  if (isInstalled) return;
  if (typeof window === 'undefined') return; // Server-side - skip

  const logger = getClientLogger();

  // Store original methods
  originalMethods = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  // Create interceptor for each method
  const createInterceptor = (method: ConsoleMethod) => {
    const original = originalMethods![method];
    const level = METHOD_TO_LEVEL[method];

    return (...args: unknown[]) => {
      // Always call original
      original(...args);

      // Skip our own logs to prevent recursion
      if (isFromLogger(args)) return;

      // Log to structured logger
      const message = serializeArgs(args);
      const error = level === 'error' ? extractError(args) : undefined;

      // Use async logging but don't await
      logger.log(
        level,
        'console',
        `console.${method}`,
        message,
        undefined,
        undefined,
        error
      ).catch(() => {
        // Ignore logging errors
      });
    };
  };

  // Install interceptors
  console.log = createInterceptor('log');
  console.warn = createInterceptor('warn');
  console.error = createInterceptor('error');
  console.info = createInterceptor('info');
  console.debug = createInterceptor('debug');

  isInstalled = true;

  // Log that we installed the interceptor
  logger.info('session', 'console_interceptor_installed', 'Console interceptor installed');
}

/**
 * Uninstall console interceptor.
 * Restores original console methods.
 */
export function uninstallConsoleInterceptor(): void {
  if (!isInstalled || !originalMethods) return;

  console.log = originalMethods.log;
  console.warn = originalMethods.warn;
  console.error = originalMethods.error;
  console.info = originalMethods.info;
  console.debug = originalMethods.debug;

  originalMethods = null;
  isInstalled = false;
}

/**
 * Check if interceptor is installed.
 */
export function isConsoleInterceptorInstalled(): boolean {
  return isInstalled;
}

/**
 * React hook for installing console interceptor.
 * Installs on mount, uninstalls on unmount.
 */
export function useConsoleInterceptor(): void {
  if (typeof window !== 'undefined') {
    // Install immediately in browser
    installConsoleInterceptor();
  }
}
