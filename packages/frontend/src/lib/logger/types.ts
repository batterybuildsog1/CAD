/**
 * Logging & Auditing Types for Antigravity CAD
 *
 * Structured logging with session tracking, request correlation,
 * and categorized events for debugging and auditing.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogCategory =
  | 'session'     // Session lifecycle events
  | 'api'         // HTTP API requests/responses
  | 'gemini'      // Gemini AI API interactions
  | 'tool'        // Tool execution (CAD operations)
  | 'wasm'        // WASM geometry operations
  | 'validation'  // Geometry/constraint validation
  | 'console';    // Captured console output

export interface LogError {
  name: string;
  message: string;
  stack?: string;
}

export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** UUID per browser session */
  sessionId: string;
  /** UUID per generation request (optional) */
  requestId?: string;
  /** Log severity level */
  level: LogLevel;
  /** Log category for filtering */
  category: LogCategory;
  /** Event type, e.g., 'generation_start', 'tool_executed' */
  event: string;
  /** Human-readable message */
  message: string;
  /** Additional structured data */
  data?: Record<string, unknown>;
  /** Duration in milliseconds for timed operations */
  durationMs?: number;
  /** Error details if applicable */
  error?: LogError;
}

export interface LogQuery {
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by request ID */
  requestId?: string;
  /** Filter by level (include this and above) */
  minLevel?: LogLevel;
  /** Filter by categories */
  categories?: LogCategory[];
  /** Filter by event types */
  events?: string[];
  /** Start time (ISO 8601) */
  startTime?: string;
  /** End time (ISO 8601) */
  endTime?: string;
  /** Maximum entries to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface LogStats {
  totalEntries: number;
  entriesByLevel: Record<LogLevel, number>;
  entriesByCategory: Record<LogCategory, number>;
  sessionCount: number;
  oldestEntry?: string;
  newestEntry?: string;
}

/** Ring buffer configuration */
export interface RingBufferConfig {
  /** Maximum entries to keep in memory */
  maxSize: number;
}

/** IndexedDB store names */
export const DB_NAME = 'antigravity-logs';
export const DB_VERSION = 1;
export const LOGS_STORE = 'logs';
export const CHAT_HISTORY_STORE = 'chatHistory';

/** Default ring buffer size */
export const DEFAULT_RING_BUFFER_SIZE = 1000;

/** Log level priority for filtering */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Helper to check if a level meets minimum threshold */
export function meetsMinLevel(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
}
