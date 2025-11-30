/**
 * Logs Export API Endpoint
 *
 * GET /api/logs/export - Export logs as downloadable JSONL file
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerLogger, getSessionIdFromHeaders, generateRequestId } from '@/lib/logger/server';
import type { LogQuery, LogCategory } from '@/lib/logger/types';

const logger = getServerLogger();

export async function GET(request: NextRequest) {
  const startTime = performance.now();
  const sessionId = getSessionIdFromHeaders(request.headers);
  const requestId = generateRequestId();

  logger.setRequestId(requestId);
  logger.logRequest('GET', '/api/logs/export', sessionId, { requestId });

  try {
    const { searchParams } = new URL(request.url);

    // Build query from params
    const query: LogQuery = {};

    const qSessionId = searchParams.get('sessionId');
    if (qSessionId) query.sessionId = qSessionId;

    const qStartTime = searchParams.get('startTime');
    if (qStartTime) query.startTime = qStartTime;

    const qEndTime = searchParams.get('endTime');
    if (qEndTime) query.endTime = qEndTime;

    const qCategories = searchParams.get('categories');
    if (qCategories) query.categories = qCategories.split(',') as LogCategory[];

    // Query logs
    const logs = logger.queryLogs(query);

    // Convert to JSONL
    const jsonl = logs.map((log) => JSON.stringify(log)).join('\n');

    // Generate filename
    const now = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = qSessionId
      ? `logs-session-${qSessionId.slice(0, 8)}-${now}.jsonl`
      : `logs-${now}.jsonl`;

    const durationMs = performance.now() - startTime;
    logger.logResponse('GET', '/api/logs/export', 200, sessionId, durationMs, {
      requestId,
      resultCount: logs.length,
      filename,
    });

    // Return as downloadable file
    return new NextResponse(jsonl, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Log-Count': logs.length.toString(),
      },
    });
  } catch (error) {
    const durationMs = performance.now() - startTime;
    const err = error instanceof Error ? error : new Error(String(error));

    logger.error('api', 'logs_export_failed', 'Failed to export logs', sessionId, err);
    logger.logResponse('GET', '/api/logs/export', 500, sessionId, durationMs);

    return NextResponse.json(
      {
        success: false,
        error: err.message,
      },
      { status: 500 }
    );
  } finally {
    logger.setRequestId(null);
  }
}
