/**
 * Gemini CAD Generation API Route
 *
 * POST /api/ai/generate
 *
 * Accepts natural language prompts and generates CAD operations using Gemini.
 * Returns a GenerationResult with tool call history and self-verification.
 *
 * @see docs/GEMINI_INTEGRATION.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { GeminiCADClient, type GenerationResult } from '@/lib/gemini-cad';
import { createHttpToolExecutor, createFallbackExecutor } from '@/lib/api-tool-executor';

// ============================================================================
// Request/Response Types
// ============================================================================

interface GenerateRequest {
  /** Natural language prompt for CAD generation */
  prompt: string;
  /** Success criteria for self-verification (optional) */
  successCriteria?: string[];
  /** Maximum tool call iterations (default: 20) */
  maxIterations?: number;
  /** Use mock executor instead of real geometry server */
  useMock?: boolean;
}

interface GenerateResponse {
  success: boolean;
  result?: GenerationResult;
  error?: string;
}

// ============================================================================
// API Route Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<GenerateResponse>> {
  // Validate API key is configured
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: 'GOOGLE_API_KEY not configured. Add it to .env.local',
      },
      { status: 500 }
    );
  }

  // Parse request body
  let body: GenerateRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid JSON in request body',
      },
      { status: 400 }
    );
  }

  // Validate required fields
  if (!body.prompt || typeof body.prompt !== 'string') {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing or invalid "prompt" field',
      },
      { status: 400 }
    );
  }

  // Create tool executor
  // Use fallback mock if useMock is true or if geometry server is unavailable
  let toolExecutor;
  if (body.useMock) {
    toolExecutor = createFallbackExecutor();
  } else {
    // Try HTTP executor, fall back to mock if server unavailable
    toolExecutor = createHttpToolExecutor();

    // Quick health check on geometry server
    try {
      const healthCheck = await fetch(
        `${process.env.GEOMETRY_SERVER_URL || 'http://localhost:3001'}/health`,
        { method: 'GET', signal: AbortSignal.timeout(2000) }
      );
      if (!healthCheck.ok) {
        console.warn('Geometry server unavailable, using fallback executor');
        toolExecutor = createFallbackExecutor();
      }
    } catch {
      console.warn('Geometry server unavailable, using fallback executor');
      toolExecutor = createFallbackExecutor();
    }
  }

  // Create Gemini CAD client
  const client = new GeminiCADClient(apiKey, toolExecutor);

  // Default success criteria if not provided
  const successCriteria = body.successCriteria || [
    'All requested entities created successfully',
    'No validation errors',
    'Geometry is valid',
  ];

  try {
    console.log('[API] Starting generation with prompt:', body.prompt.substring(0, 100));

    // Generate with feedback loop
    const result = await client.generateWithFeedback(
      body.prompt,
      successCriteria,
      body.maxIterations || 20
    );

    console.log('[API] Generation complete. Success:', result.success, 'Tool calls:', result.toolCallHistory.length);

    return NextResponse.json({
      success: result.success,
      result,
    });
  } catch (error) {
    console.error('[API] Generation error:', error);

    // Include stack trace for debugging
    const errorMessage = error instanceof Error
      ? `${error.message}${error.stack ? `\n\nStack: ${error.stack}` : ''}`
      : 'Unknown generation error';

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET handler for health check
// ============================================================================

export async function GET(): Promise<NextResponse> {
  const apiKey = process.env.GOOGLE_API_KEY;

  return NextResponse.json({
    status: 'ok',
    service: 'Gemini CAD Generation',
    apiKeyConfigured: !!apiKey,
    geometryServerUrl: process.env.GEOMETRY_SERVER_URL || 'http://localhost:3001',
  });
}
