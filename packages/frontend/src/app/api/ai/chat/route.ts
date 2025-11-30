/**
 * Gemini CAD Chat Proxy API Route
 *
 * POST /api/ai/chat
 *
 * This is a THIN PROXY that only handles Gemini API calls.
 * Tool execution happens client-side via WASM for zero latency.
 *
 * Flow:
 * 1. Client sends prompt + conversation history
 * 2. Server calls Gemini with API key (secure)
 * 3. Server returns raw Gemini response (including function calls)
 * 4. Client executes function calls locally via WasmStore
 * 5. Client sends function responses back to continue conversation
 *
 * Benefits:
 * - API key stays server-side (secure)
 * - Tool execution happens in browser (zero latency)
 * - WASM store shared with 3D renderer (instant updates)
 *
 * @see docs/GEMINI_INTEGRATION.md
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
} from '@google/genai';
import { CAD_SYSTEM_PROMPT, CAD_FUNCTION_DECLARATIONS } from '@/lib/gemini-cad';
import { SKILL_FUNCTION_DECLARATIONS } from '@/lib/cad-skills';
import { getServerLogger, getSessionIdFromHeaders, generateRequestId } from '@/lib/logger/server';

// ============================================================================
// Request/Response Types
// ============================================================================

interface ChatRequest {
  /** The message to send (user prompt or function responses) */
  message: string | FunctionResponsePart[];
  /** Conversation history (for multi-turn) */
  history?: Content[];
}

interface FunctionResponsePart {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
  };
  thoughtSignature?: string;
}

interface FunctionCallWithSignature {
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

interface ChatResponse {
  success: boolean;
  /** Text response from Gemini (if any) */
  text?: string;
  /** Function calls to execute client-side (with thought signatures for Gemini 3) */
  functionCalls?: FunctionCallWithSignature[];
  /** Updated history for next turn */
  history?: Content[];
  /** Error message if failed */
  error?: string;
  /** Thinking summary from Gemini (if available) */
  thinking?: string;
  /** Token usage from this API call */
  usage?: {
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
  };
}

// All function declarations (base tools + skills)
const ALL_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  ...CAD_FUNCTION_DECLARATIONS,
  ...SKILL_FUNCTION_DECLARATIONS,
];

// ============================================================================
// API Route Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<ChatResponse>> {
  const logger = getServerLogger();
  const sessionId = getSessionIdFromHeaders(request.headers);
  const requestId = generateRequestId();
  const startTime = performance.now();

  logger.setRequestId(requestId);
  logger.logRequest('POST', '/api/ai/chat', sessionId, { requestId });

  // Validate API key is configured
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    logger.error('gemini', 'api_key_missing', 'GOOGLE_API_KEY not configured', sessionId);
    logger.setRequestId(null);
    return NextResponse.json(
      {
        success: false,
        error: 'GOOGLE_API_KEY not configured. Add it to .env.local',
      },
      { status: 500 }
    );
  }

  // Parse request body
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    logger.error('api', 'parse_error', 'Invalid JSON in request body', sessionId);
    logger.setRequestId(null);
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid JSON in request body',
      },
      { status: 400 }
    );
  }

  // Validate message
  if (!body.message) {
    logger.error('api', 'validation_error', 'Missing message field', sessionId);
    logger.setRequestId(null);
    return NextResponse.json(
      {
        success: false,
        error: 'Missing "message" field',
      },
      { status: 400 }
    );
  }

  // Log request details
  const isInitialPrompt = typeof body.message === 'string';
  logger.logGeminiRequest(
    isInitialPrompt ? 'prompt' : 'function_response',
    sessionId,
    {
      historyLength: body.history?.length || 0,
      messageType: isInitialPrompt ? 'string' : 'function_responses',
      messagePreview: isInitialPrompt
        ? (body.message as string).substring(0, 100)
        : `${(body.message as FunctionResponsePart[]).length} function responses`,
    }
  );

  try {
    // Create Gemini client
    const ai = new GoogleGenAI({ apiKey });

    // Create chat session with history
    // Configuration per docs/GEMINI_INTEGRATION.md:
    // - temperature: 1.0 (always - allows architectural creativity with thinking)
    // - thinkingConfig: always enabled for complex CAD reasoning
    const chat = ai.chats.create({
      model: 'gemini-3-pro-preview',
      config: {
        systemInstruction: CAD_SYSTEM_PROMPT,
        tools: [{ functionDeclarations: ALL_FUNCTION_DECLARATIONS }],
        temperature: 1.0,
        thinkingConfig: {
          thinkingBudget: 32768,
          includeThoughts: true,
        },
      },
      history: body.history || [],
    });

    // Send message
    // Handle both string prompts and function response arrays
    let messageParts: Part[];
    if (typeof body.message === 'string') {
      messageParts = [{ text: body.message }];
    } else {
      // Function responses - include thoughtSignature for Gemini 3 Pro
      messageParts = body.message.map(fr => {
        const part: Record<string, unknown> = {
          functionResponse: fr.functionResponse,
        };
        // Include thoughtSignature if present (required for Gemini 3 Pro)
        if (fr.thoughtSignature) {
          part.thoughtSignature = fr.thoughtSignature;
        }
        return part;
      }) as Part[];
    }

    const response = await chat.sendMessage({ message: messageParts });

    // Extract token usage metadata
    const usageMetadata = response.usageMetadata;

    // Extract function calls with thought signatures (required for Gemini 3 Pro)
    // Access the raw response to get thoughtSignature
    const rawParts = response.candidates?.[0]?.content?.parts || [];
    const functionCalls: FunctionCallWithSignature[] = [];

    for (const part of rawParts) {
      const partAny = part as Record<string, unknown>;
      if (partAny.functionCall) {
        const fc = partAny.functionCall as { name?: string; args?: Record<string, unknown> };
        if (fc.name) {
          functionCalls.push({
            name: fc.name,
            args: (fc.args || {}) as Record<string, unknown>,
            thoughtSignature: partAny.thoughtSignature as string | undefined,
          });
        }
      }
    }

    // Extract thinking summary from response parts
    let thinkingSummary: string | undefined;
    for (const part of rawParts) {
      const partAny = part as Record<string, unknown>;
      if (partAny.thought === true && typeof partAny.text === 'string') {
        thinkingSummary = partAny.text;
        break; // Take first thinking part
      }
    }

    // Build updated history from chat
    // The SDK manages history internally, but we need to return it
    // for the client to pass back on next turn
    const updatedHistory: Content[] = body.history ? [...body.history] : [];

    // Add the user message
    updatedHistory.push({
      role: 'user',
      parts: messageParts,
    });

    // Add the model response - preserve raw parts to keep thoughtSignatures
    if (rawParts.length > 0) {
      updatedHistory.push({
        role: 'model',
        parts: rawParts as Part[],
      });
    }

    const durationMs = performance.now() - startTime;
    const usage = usageMetadata ? {
      promptTokens: usageMetadata.promptTokenCount ?? 0,
      responseTokens: usageMetadata.candidatesTokenCount ?? 0,
      totalTokens: usageMetadata.totalTokenCount ?? 0,
    } : undefined;

    logger.logGeminiResponse(
      isInitialPrompt ? 'prompt' : 'function_response',
      sessionId,
      durationMs,
      true,
      {
        functionCallCount: functionCalls.length,
        hasText: !!response.text,
        hasThinking: !!thinkingSummary,
        tokenUsage: usage,
      }
    );
    logger.logResponse('POST', '/api/ai/chat', 200, sessionId, durationMs);
    logger.setRequestId(null);

    return NextResponse.json({
      success: true,
      text: response.text || undefined,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      history: updatedHistory,
      thinking: thinkingSummary,
      usage,
    });
  } catch (error) {
    const durationMs = performance.now() - startTime;
    const errorMessage = error instanceof Error
      ? error.message
      : 'Unknown chat error';

    logger.logGeminiResponse(
      isInitialPrompt ? 'prompt' : 'function_response',
      sessionId,
      durationMs,
      false,
      { error: errorMessage },
      error instanceof Error ? error : undefined
    );
    logger.logResponse('POST', '/api/ai/chat', 500, sessionId, durationMs);
    logger.setRequestId(null);

    console.error('[API] Chat error:', error);

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
    service: 'Gemini CAD Chat Proxy',
    apiKeyConfigured: !!apiKey,
    mode: 'hybrid - Gemini on server, WASM execution on client',
  });
}
