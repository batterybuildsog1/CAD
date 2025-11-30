/**
 * Logs API Endpoint
 *
 * GET /api/logs - Query server-side logs
 * POST /api/logs - Write a log entry from client
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerLogger, getSessionIdFromHeaders, generateRequestId } from '@/lib/logger/server';
import type { LogEntry, LogLevel, LogCategory, LogQuery } from '@/lib/logger/types';

const logger = getServerLogger();

export async function GET(request: NextRequest) {
  const startTime = performance.now();
  const sessionId = getSessionIdFromHeaders(request.headers);
  const requestId = generateRequestId();

  logger.setRequestId(requestId);
  logger.logRequest('GET', '/api/logs', sessionId, { requestId });

  try {
    const { searchParams } = new URL(request.url);

    // Build query from params
    const query: LogQuery = {};

    const qSessionId = searchParams.get('sessionId');
    if (qSessionId) query.sessionId = qSessionId;

    const qRequestId = searchParams.get('requestId');
    if (qRequestId) query.requestId = qRequestId;

    const qMinLevel = searchParams.get('minLevel') as LogLevel | null;
    if (qMinLevel) query.minLevel = qMinLevel;

    const qCategories = searchParams.get('categories');
    if (qCategories) query.categories = qCategories.split(',') as LogCategory[];

    const qEvents = searchParams.get('events');
    if (qEvents) query.events = qEvents.split(',');

    const qStartTime = searchParams.get('startTime');
    if (qStartTime) query.startTime = qStartTime;

    const qEndTime = searchParams.get('endTime');
    if (qEndTime) query.endTime = qEndTime;

    const qLimit = searchParams.get('limit');
    if (qLimit) query.limit = parseInt(qLimit, 10);

    const qOffset = searchParams.get('offset');
    if (qOffset) query.offset = parseInt(qOffset, 10);

    // Query logs
    const logs = logger.queryLogs(query);

    const durationMs = performance.now() - startTime;
    logger.logResponse('GET', '/api/logs', 200, sessionId, durationMs, {
      requestId,
      resultCount: logs.length,
    });

    return NextResponse.json({
      success: true,
      data: logs,
      meta: {
        count: logs.length,
        query,
      },
    });
  } catch (error) {
    const durationMs = performance.now() - startTime;
    const err = error instanceof Error ? error : new Error(String(error));

    logger.error('api', 'logs_query_failed', 'Failed to query logs', sessionId, err);
    logger.logResponse('GET', '/api/logs', 500, sessionId, durationMs);

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

export async function POST(request: NextRequest) {
  const startTime = performance.now();
  const sessionId = getSessionIdFromHeaders(request.headers);
  const requestId = generateRequestId();

  logger.setRequestId(requestId);

  try {
    const body = await request.json();

    // Validate required fields
    const { level, category, event, message, data, durationMs, error: errorData } = body;

    if (!level || !category || !event || !message) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: level, category, event, message',
        },
        { status: 400 }
      );
    }

    // Convert error data back to Error if present
    let error: Error | undefined;
    if (errorData) {
      error = new Error(errorData.message);
      error.name = errorData.name;
      if (errorData.stack) {
        error.stack = errorData.stack;
      }
    }

    // Log the entry
    logger.log(
      level as LogLevel,
      category as LogCategory,
      event,
      message,
      sessionId,
      data,
      durationMs,
      error
    );

    const durationMsTotal = performance.now() - startTime;
    logger.logResponse('POST', '/api/logs', 201, sessionId, durationMsTotal);

    return NextResponse.json(
      {
        success: true,
        message: 'Log entry recorded',
      },
      { status: 201 }
    );
  } catch (error) {
    const durationMs = performance.now() - startTime;
    const err = error instanceof Error ? error : new Error(String(error));

    logger.error('api', 'logs_write_failed', 'Failed to write log', sessionId, err);
    logger.logResponse('POST', '/api/logs', 500, sessionId, durationMs);

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
