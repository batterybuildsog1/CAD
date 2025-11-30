/**
 * Server-side Logger for Antigravity CAD
 *
 * Writes logs to date-partitioned JSONL files in .logs/ directory.
 * Supports multiple log categories with separate files.
 */

import fs from 'fs';
import path from 'path';
import { LogEntry, LogLevel, LogCategory, LogQuery, meetsMinLevel } from './types';

const LOGS_DIR = path.join(process.cwd(), '.logs');

/** Ensure logs directory exists */
function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/** Get log file path for a given category and date */
function getLogFilePath(category: LogCategory, date: Date = new Date()): string {
  ensureLogsDir();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOGS_DIR, `${category}-${dateStr}.jsonl`);
}

/** Get all log files for a category */
function getLogFiles(category?: LogCategory): string[] {
  ensureLogsDir();
  const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith('.jsonl'));

  if (category) {
    return files.filter((f) => f.startsWith(`${category}-`));
  }

  return files;
}

/** Server Logger class */
class ServerLogger {
  private currentRequestId: string | null = null;

  /** Set current request ID for correlation */
  setRequestId(requestId: string | null): void {
    this.currentRequestId = requestId;
  }

  /** Core logging method */
  log(
    level: LogLevel,
    category: LogCategory,
    event: string,
    message: string,
    sessionId: string = 'server',
    data?: Record<string, unknown>,
    durationMs?: number,
    error?: Error
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      sessionId,
      requestId: this.currentRequestId || undefined,
      level,
      category,
      event,
      message,
      data,
      durationMs,
      error: error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : undefined,
    };

    // Write to category-specific file
    const filePath = getLogFilePath(category);
    const line = JSON.stringify(entry) + '\n';

    try {
      fs.appendFileSync(filePath, line);
    } catch (err) {
      console.error('ServerLogger: Failed to write log', err);
    }

    // Also write errors to errors file
    if (level === 'error') {
      const errorFilePath = getLogFilePath('validation'); // errors go to validation
      try {
        fs.appendFileSync(errorFilePath, line);
      } catch (err) {
        // Ignore secondary write failure
      }
    }

    // Console output in development
    if (process.env.NODE_ENV === 'development') {
      const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[consoleMethod](`[SERVER:${category}:${event}]`, message, data || '');
    }
  }

  // Convenience methods
  debug(
    category: LogCategory,
    event: string,
    message: string,
    sessionId?: string,
    data?: Record<string, unknown>
  ): void {
    this.log('debug', category, event, message, sessionId, data);
  }

  info(
    category: LogCategory,
    event: string,
    message: string,
    sessionId?: string,
    data?: Record<string, unknown>
  ): void {
    this.log('info', category, event, message, sessionId, data);
  }

  warn(
    category: LogCategory,
    event: string,
    message: string,
    sessionId?: string,
    data?: Record<string, unknown>
  ): void {
    this.log('warn', category, event, message, sessionId, data);
  }

  error(
    category: LogCategory,
    event: string,
    message: string,
    sessionId?: string,
    error?: Error,
    data?: Record<string, unknown>
  ): void {
    this.log('error', category, event, message, sessionId, data, undefined, error);
  }

  /** Log API request */
  logRequest(
    method: string,
    path: string,
    sessionId: string,
    data?: Record<string, unknown>
  ): void {
    this.info('api', 'request', `${method} ${path}`, sessionId, {
      method,
      path,
      ...data,
    });
  }

  /** Log API response */
  logResponse(
    method: string,
    path: string,
    statusCode: number,
    sessionId: string,
    durationMs: number,
    data?: Record<string, unknown>
  ): void {
    const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    this.log(level, 'api', 'response', `${method} ${path} - ${statusCode}`, sessionId, {
      method,
      path,
      statusCode,
      ...data,
    }, durationMs);
  }

  /** Log Gemini API call */
  logGeminiRequest(
    operation: string,
    sessionId: string,
    data?: Record<string, unknown>
  ): void {
    this.info('gemini', 'request', `Gemini: ${operation}`, sessionId, data);
  }

  /** Log Gemini API response */
  logGeminiResponse(
    operation: string,
    sessionId: string,
    durationMs: number,
    success: boolean,
    data?: Record<string, unknown>,
    error?: Error
  ): void {
    if (success) {
      this.log('info', 'gemini', 'response', `Gemini: ${operation} completed`, sessionId, data, durationMs);
    } else {
      this.log('error', 'gemini', 'response', `Gemini: ${operation} failed`, sessionId, data, durationMs, error);
    }
  }

  /** Log tool execution */
  logToolExecution(
    toolName: string,
    sessionId: string,
    durationMs: number,
    success: boolean,
    data?: Record<string, unknown>,
    error?: Error
  ): void {
    const level: LogLevel = success ? 'info' : 'error';
    this.log(level, 'tool', 'executed', `Tool: ${toolName}`, sessionId, {
      toolName,
      success,
      ...data,
    }, durationMs, error);
  }

  /** Query logs from files */
  queryLogs(query: LogQuery): LogEntry[] {
    const results: LogEntry[] = [];
    const categories = query.categories || (['api', 'gemini', 'tool', 'wasm', 'validation', 'session', 'console'] as LogCategory[]);

    for (const category of categories) {
      const files = getLogFiles(category);

      for (const file of files) {
        // Filter by date if specified
        if (query.startTime || query.endTime) {
          const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const fileDate = dateMatch[1];
            if (query.startTime && fileDate < query.startTime.split('T')[0]) continue;
            if (query.endTime && fileDate > query.endTime.split('T')[0]) continue;
          }
        }

        try {
          const content = fs.readFileSync(path.join(LOGS_DIR, file), 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);

          for (const line of lines) {
            try {
              const entry = JSON.parse(line) as LogEntry;

              // Apply filters
              if (query.sessionId && entry.sessionId !== query.sessionId) continue;
              if (query.requestId && entry.requestId !== query.requestId) continue;
              if (query.minLevel && !meetsMinLevel(entry.level, query.minLevel)) continue;
              if (query.events && !query.events.includes(entry.event)) continue;
              if (query.startTime && entry.timestamp < query.startTime) continue;
              if (query.endTime && entry.timestamp > query.endTime) continue;

              results.push(entry);
            } catch {
              // Skip malformed lines
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Sort by timestamp
    results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Apply offset and limit
    const offset = query.offset || 0;
    const limit = query.limit || results.length;

    return results.slice(offset, offset + limit);
  }

  /** Get logs for a specific session */
  getSessionLogs(sessionId: string): LogEntry[] {
    return this.queryLogs({ sessionId });
  }

  /** Export session logs as JSONL string */
  exportSessionLogs(sessionId: string): string {
    const logs = this.getSessionLogs(sessionId);
    return logs.map((log) => JSON.stringify(log)).join('\n');
  }

  /** Get list of available log files */
  getLogFileList(): Array<{ file: string; size: number; modified: Date }> {
    ensureLogsDir();
    const files = getLogFiles();

    return files.map((file) => {
      const filePath = path.join(LOGS_DIR, file);
      const stats = fs.statSync(filePath);
      return {
        file,
        size: stats.size,
        modified: stats.mtime,
      };
    });
  }

  /** Delete old log files */
  pruneOldLogs(daysToKeep: number = 30): number {
    ensureLogsDir();
    const files = getLogFiles();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    let deleted = 0;

    for (const file of files) {
      const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch && dateMatch[1] < cutoffStr) {
        try {
          fs.unlinkSync(path.join(LOGS_DIR, file));
          deleted++;
        } catch {
          // Ignore delete failures
        }
      }
    }

    return deleted;
  }
}

// Singleton instance
let serverLoggerInstance: ServerLogger | null = null;

export function getServerLogger(): ServerLogger {
  if (!serverLoggerInstance) {
    serverLoggerInstance = new ServerLogger();
  }
  return serverLoggerInstance;
}

export { ServerLogger };
