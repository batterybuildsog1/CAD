'use client';

import { useEffect } from 'react';
import { installConsoleInterceptor, getClientLogger, getSessionId } from '@/lib/logger';

interface LoggerProviderProps {
  children: React.ReactNode;
}

/**
 * LoggerProvider - Client component that initializes logging infrastructure
 *
 * Must be placed at the root of the application to capture all console output.
 * Installs console interceptor and logs session start.
 */
export function LoggerProvider({ children }: LoggerProviderProps) {
  useEffect(() => {
    // Install console interceptor to capture all console output
    installConsoleInterceptor();

    // Initialize client logger
    const logger = getClientLogger();
    logger.init();

    // Log session start
    const sessionId = getSessionId();
    logger.info('session', 'session_start', 'Browser session started', {
      sessionId,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      timestamp: new Date().toISOString(),
    });

    // Log session end on unload
    const handleUnload = () => {
      logger.info('session', 'session_end', 'Browser session ended', {
        sessionId,
        duration: typeof performance !== 'undefined' ? performance.now() : 0,
      });
    };

    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  return <>{children}</>;
}

export default LoggerProvider;
