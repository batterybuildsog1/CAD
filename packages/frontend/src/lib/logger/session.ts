/**
 * Session Management for Antigravity CAD Logging
 *
 * Generates and persists session IDs for tracking user sessions
 * across page reloads. Session ID is stored in localStorage and
 * sent with API requests via X-Session-Id header.
 */

const SESSION_ID_KEY = 'antigravity-session-id';
const SESSION_START_KEY = 'antigravity-session-start';

/** Generate a UUID v4 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Check if we're in a browser environment */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/**
 * Get or create a session ID.
 * Creates a new session if none exists or if the session has expired.
 */
export function getSessionId(): string {
  if (!isBrowser()) {
    // Server-side: return a placeholder
    return 'server-side';
  }

  let sessionId = localStorage.getItem(SESSION_ID_KEY);
  const sessionStart = localStorage.getItem(SESSION_START_KEY);

  // Check if session exists and is less than 24 hours old
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();

  if (!sessionId || !sessionStart || now - parseInt(sessionStart, 10) > maxAge) {
    // Create new session
    sessionId = generateUUID();
    localStorage.setItem(SESSION_ID_KEY, sessionId);
    localStorage.setItem(SESSION_START_KEY, now.toString());
  }

  return sessionId;
}

/**
 * Force creation of a new session ID.
 * Useful for explicit session reset (e.g., logout).
 */
export function resetSession(): string {
  if (!isBrowser()) {
    return 'server-side';
  }

  const sessionId = generateUUID();
  const now = Date.now();

  localStorage.setItem(SESSION_ID_KEY, sessionId);
  localStorage.setItem(SESSION_START_KEY, now.toString());

  return sessionId;
}

/**
 * Get the session start time.
 */
export function getSessionStartTime(): Date | null {
  if (!isBrowser()) {
    return null;
  }

  const sessionStart = localStorage.getItem(SESSION_START_KEY);
  if (!sessionStart) {
    return null;
  }

  return new Date(parseInt(sessionStart, 10));
}

/**
 * Get session duration in milliseconds.
 */
export function getSessionDuration(): number {
  const startTime = getSessionStartTime();
  if (!startTime) {
    return 0;
  }
  return Date.now() - startTime.getTime();
}

/**
 * Generate a request ID for correlating logs within a single operation.
 */
export function generateRequestId(): string {
  return generateUUID();
}

/**
 * Get headers to include with API requests for session tracking.
 */
export function getSessionHeaders(): Record<string, string> {
  return {
    'X-Session-Id': getSessionId(),
  };
}

/**
 * Extract session ID from request headers (server-side).
 */
export function getSessionIdFromHeaders(
  headers: Headers | Record<string, string>
): string {
  if (headers instanceof Headers) {
    return headers.get('x-session-id') || 'unknown';
  }
  return headers['x-session-id'] || headers['X-Session-Id'] || 'unknown';
}
