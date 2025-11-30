/**
 * Client-side Logger for Antigravity CAD
 *
 * Uses IndexedDB for persistent storage and a ring buffer for
 * fast access to recent logs. All logs are tagged with session ID.
 */

import {
  LogEntry,
  LogLevel,
  LogCategory,
  LogQuery,
  LogStats,
  DB_NAME,
  DB_VERSION,
  LOGS_STORE,
  DEFAULT_RING_BUFFER_SIZE,
  meetsMinLevel,
  LOG_LEVEL_PRIORITY,
} from './types';
import { getSessionId, generateRequestId } from './session';

/** Ring buffer for fast access to recent logs */
class RingBuffer<T> {
  private buffer: T[];
  private head: number = 0;
  private size: number = 0;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.buffer = new Array(maxSize);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.maxSize;
    if (this.size < this.maxSize) {
      this.size++;
    }
  }

  getAll(): T[] {
    if (this.size === 0) return [];

    const result: T[] = [];
    const start = this.size < this.maxSize ? 0 : this.head;

    for (let i = 0; i < this.size; i++) {
      const idx = (start + i) % this.maxSize;
      result.push(this.buffer[idx]);
    }

    return result;
  }

  clear(): void {
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.size = 0;
  }

  getSize(): number {
    return this.size;
  }
}

/** Client Logger class */
class ClientLogger {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private ringBuffer: RingBuffer<LogEntry>;
  private currentRequestId: string | null = null;
  private isInitialized: boolean = false;

  constructor(ringBufferSize: number = DEFAULT_RING_BUFFER_SIZE) {
    this.ringBuffer = new RingBuffer<LogEntry>(ringBufferSize);
  }

  /** Initialize IndexedDB */
  private async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not available'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create logs store with indexes
        if (!db.objectStoreNames.contains(LOGS_STORE)) {
          const store = db.createObjectStore(LOGS_STORE, {
            keyPath: 'id',
            autoIncrement: true,
          });

          store.createIndex('timestamp', 'timestamp');
          store.createIndex('sessionId', 'sessionId');
          store.createIndex('requestId', 'requestId');
          store.createIndex('level', 'level');
          store.createIndex('category', 'category');
          store.createIndex('event', 'event');
          store.createIndex('session-timestamp', ['sessionId', 'timestamp']);
        }
      };
    });

    return this.dbPromise;
  }

  /** Ensure logger is ready */
  async init(): Promise<void> {
    try {
      await this.initDB();
    } catch (error) {
      console.warn('ClientLogger: IndexedDB init failed, using memory only', error);
    }
  }

  /** Set current request ID for correlation */
  setRequestId(requestId: string | null): void {
    this.currentRequestId = requestId;
  }

  /** Generate and set a new request ID */
  startRequest(): string {
    const requestId = generateRequestId();
    this.currentRequestId = requestId;
    return requestId;
  }

  /** Clear current request ID */
  endRequest(): void {
    this.currentRequestId = null;
  }

  /** Core logging method */
  async log(
    level: LogLevel,
    category: LogCategory,
    event: string,
    message: string,
    data?: Record<string, unknown>,
    durationMs?: number,
    error?: Error
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: getSessionId(),
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

    // Always add to ring buffer (fast, synchronous)
    this.ringBuffer.push(entry);

    // Persist to IndexedDB (async, best-effort)
    try {
      const db = await this.initDB();
      const tx = db.transaction(LOGS_STORE, 'readwrite');
      const store = tx.objectStore(LOGS_STORE);
      store.add(entry);
    } catch (error) {
      // Silently fail - ring buffer still has the log
    }

    // Also output to console in development
    if (process.env.NODE_ENV === 'development') {
      const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[consoleMethod](`[${category}:${event}]`, message, data || '');
    }
  }

  // Convenience methods
  debug(category: LogCategory, event: string, message: string, data?: Record<string, unknown>): Promise<void> {
    return this.log('debug', category, event, message, data);
  }

  info(category: LogCategory, event: string, message: string, data?: Record<string, unknown>): Promise<void> {
    return this.log('info', category, event, message, data);
  }

  warn(category: LogCategory, event: string, message: string, data?: Record<string, unknown>): Promise<void> {
    return this.log('warn', category, event, message, data);
  }

  error(
    category: LogCategory,
    event: string,
    message: string,
    error?: Error,
    data?: Record<string, unknown>
  ): Promise<void> {
    return this.log('error', category, event, message, data, undefined, error);
  }

  /** Log with timing */
  async timed<T>(
    category: LogCategory,
    event: string,
    message: string,
    fn: () => Promise<T>,
    data?: Record<string, unknown>
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = performance.now() - start;
      await this.log('info', category, event, message, { ...data, success: true }, durationMs);
      return result;
    } catch (error) {
      const durationMs = performance.now() - start;
      await this.log(
        'error',
        category,
        event,
        `${message} - failed`,
        { ...data, success: false },
        durationMs,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /** Get recent logs from ring buffer */
  getRecentLogs(limit?: number): LogEntry[] {
    const all = this.ringBuffer.getAll();
    if (limit && limit < all.length) {
      return all.slice(-limit);
    }
    return all;
  }

  /** Query logs from IndexedDB */
  async queryLogs(query: LogQuery): Promise<LogEntry[]> {
    try {
      const db = await this.initDB();
      const tx = db.transaction(LOGS_STORE, 'readonly');
      const store = tx.objectStore(LOGS_STORE);

      return new Promise((resolve, reject) => {
        const results: LogEntry[] = [];
        let request: IDBRequest;

        // Use appropriate index based on query
        if (query.sessionId) {
          const index = store.index('session-timestamp');
          const range = IDBKeyRange.bound(
            [query.sessionId, query.startTime || ''],
            [query.sessionId, query.endTime || '\uffff']
          );
          request = index.openCursor(range);
        } else {
          const index = store.index('timestamp');
          const range =
            query.startTime || query.endTime
              ? IDBKeyRange.bound(query.startTime || '', query.endTime || '\uffff')
              : undefined;
          request = index.openCursor(range);
        }

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const entry = cursor.value as LogEntry;

            // Apply filters
            let include = true;

            if (query.minLevel && !meetsMinLevel(entry.level, query.minLevel)) {
              include = false;
            }
            if (query.categories && !query.categories.includes(entry.category)) {
              include = false;
            }
            if (query.events && !query.events.includes(entry.event)) {
              include = false;
            }
            if (query.requestId && entry.requestId !== query.requestId) {
              include = false;
            }

            if (include) {
              results.push(entry);
            }

            // Check limit
            if (query.limit && results.length >= query.limit + (query.offset || 0)) {
              resolve(results.slice(query.offset || 0, query.limit + (query.offset || 0)));
              return;
            }

            cursor.continue();
          } else {
            resolve(results.slice(query.offset || 0));
          }
        };

        request.onerror = () => reject(request.error);
      });
    } catch {
      // Fallback to ring buffer
      return this.getRecentLogs(query.limit);
    }
  }

  /** Get log statistics */
  async getStats(): Promise<LogStats> {
    const logs = await this.queryLogs({});

    const stats: LogStats = {
      totalEntries: logs.length,
      entriesByLevel: { debug: 0, info: 0, warn: 0, error: 0 },
      entriesByCategory: {
        session: 0,
        api: 0,
        gemini: 0,
        tool: 0,
        wasm: 0,
        validation: 0,
        console: 0,
      },
      sessionCount: 0,
    };

    const sessions = new Set<string>();

    for (const log of logs) {
      stats.entriesByLevel[log.level]++;
      stats.entriesByCategory[log.category]++;
      sessions.add(log.sessionId);

      if (!stats.oldestEntry || log.timestamp < stats.oldestEntry) {
        stats.oldestEntry = log.timestamp;
      }
      if (!stats.newestEntry || log.timestamp > stats.newestEntry) {
        stats.newestEntry = log.timestamp;
      }
    }

    stats.sessionCount = sessions.size;

    return stats;
  }

  /** Clear all logs */
  async clearLogs(): Promise<void> {
    this.ringBuffer.clear();

    try {
      const db = await this.initDB();
      const tx = db.transaction(LOGS_STORE, 'readwrite');
      const store = tx.objectStore(LOGS_STORE);
      store.clear();
    } catch {
      // Ignore DB errors
    }
  }

  /** Export logs for current session as JSONL */
  async exportSessionLogs(sessionId?: string): Promise<string> {
    const logs = await this.queryLogs({
      sessionId: sessionId || getSessionId(),
    });

    return logs.map((log) => JSON.stringify(log)).join('\n');
  }
}

// Singleton instance
let loggerInstance: ClientLogger | null = null;

export function getClientLogger(): ClientLogger {
  if (!loggerInstance) {
    loggerInstance = new ClientLogger();
  }
  return loggerInstance;
}

export { ClientLogger };
