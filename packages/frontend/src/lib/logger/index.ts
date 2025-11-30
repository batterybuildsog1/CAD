/**
 * Client-side Logger Exports for Antigravity CAD
 *
 * Import this module in client-side code.
 * For server-side code, use './server' instead.
 */

// Types
export type {
  LogEntry,
  LogLevel,
  LogCategory,
  LogQuery,
  LogStats,
  LogError,
  RingBufferConfig,
} from './types';

export {
  DB_NAME,
  DB_VERSION,
  LOGS_STORE,
  CHAT_HISTORY_STORE,
  DEFAULT_RING_BUFFER_SIZE,
  LOG_LEVEL_PRIORITY,
  meetsMinLevel,
} from './types';

// Session management
export {
  getSessionId,
  resetSession,
  getSessionStartTime,
  getSessionDuration,
  generateRequestId,
  getSessionHeaders,
} from './session';

// Client logger
export { getClientLogger, ClientLogger } from './client-logger';

// Console interceptor
export {
  installConsoleInterceptor,
  uninstallConsoleInterceptor,
  isConsoleInterceptorInstalled,
  useConsoleInterceptor,
} from './console-interceptor';

// Convenience: default logger instance
import { getClientLogger } from './client-logger';

const logger = getClientLogger();

export default logger;
