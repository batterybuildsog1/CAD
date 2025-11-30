/**
 * Server-side Logger Exports for Antigravity CAD
 *
 * Import this module in server-side code (API routes, etc.).
 * For client-side code, use './index' instead.
 */

// Types
export type {
  LogEntry,
  LogLevel,
  LogCategory,
  LogQuery,
  LogStats,
  LogError,
} from './types';

export {
  LOG_LEVEL_PRIORITY,
  meetsMinLevel,
} from './types';

// Session utilities (for extracting from headers)
export {
  getSessionIdFromHeaders,
  generateRequestId,
} from './session';

// Server logger
export { getServerLogger, ServerLogger } from './server-logger';

// Convenience: default logger instance
import { getServerLogger } from './server-logger';

const serverLogger = getServerLogger();

export default serverLogger;
