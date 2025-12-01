/**
 * Visual Feedback System for Gemini 3.0 Pro
 *
 * Captures screenshots of the CAD view and sends them to Gemini for
 * visual verification and refinement. Implements the visual feedback loop
 * with medium resolution (560 tokens) and max 2 iterations.
 */

import type { RoomSummary } from './wasm-store.svelte';

// ============================================================================
// Configuration
// ============================================================================

/** Image quality for JPEG encoding (0.85 = medium quality, ~560 tokens) */
const IMAGE_QUALITY = 0.85;

/** Maximum refinement iterations */
const MAX_ITERATIONS = 2;

// ============================================================================
// Screenshot Capture
// ============================================================================

/**
 * Capture a screenshot from the Three.js canvas
 */
export async function captureCanvas(canvas: HTMLCanvasElement): Promise<string> {
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
}

/**
 * Capture canvas with room labels overlaid
 * Creates an offscreen canvas to draw labels without affecting the original
 */
export async function captureWithLabels(
  canvas: HTMLCanvasElement,
  rooms: RoomSummary[]
): Promise<string> {
  // Create offscreen canvas at same size
  const offscreen = document.createElement('canvas');
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const ctx = offscreen.getContext('2d')!;

  // Draw the original canvas content
  ctx.drawImage(canvas, 0, 0);

  // Configure label styling
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Draw room labels
  for (const room of rooms) {
    // Convert world coordinates to screen coordinates
    // This is a simplified projection - real implementation would use Three.js camera
    const screenX = (room.center[0] / 50) * canvas.width + canvas.width / 2;
    const screenY = canvas.height / 2 - (room.center[1] / 50) * canvas.height;

    // Draw background pill for readability
    const label = `${room.name}\n${room.dimensions.width}'×${room.dimensions.depth}'`;
    const lines = label.split('\n');

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.roundRect(screenX - 50, screenY - 20, 100, 40, 6);
    ctx.fill();

    // Draw text
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) => {
      ctx.fillText(line, screenX, screenY + (i - 0.5) * 16);
    });
  }

  return offscreen.toDataURL('image/jpeg', IMAGE_QUALITY);
}

// ============================================================================
// Visual Feedback Types
// ============================================================================

export interface VisualFeedbackResponse {
  validated: boolean;
  corrections: string | null;
  issues: VisualIssue[];
}

export interface VisualIssue {
  type: 'overlap' | 'out_of_bounds' | 'missing_room' | 'wrong_dimensions' | 'other';
  description: string;
  affectedRooms?: string[];
}

// ============================================================================
// Gemini Vision Integration
// ============================================================================

const VISUAL_VALIDATION_PROMPT = `Review this floor plan rendering. Analyze the spatial layout and identify any issues:

1. ROOM OVERLAPS: Are any rooms overlapping each other?
2. BOUNDARY VIOLATIONS: Are any rooms extending outside the building footprint?
3. MISSING ROOMS: Based on a standard residential layout, are there obvious missing rooms?
4. DIMENSION ISSUES: Do room proportions look reasonable for their types?

If the layout is correct and has no issues, respond with exactly: "VALIDATED"

Otherwise, list the specific corrections needed in this format:
CORRECTIONS:
- [Issue 1]: [Specific fix needed]
- [Issue 2]: [Specific fix needed]`;

/**
 * Parse Gemini's visual validation response
 */
export function parseVisualFeedback(responseText: string): VisualFeedbackResponse {
  const text = responseText.trim();

  // Check for validation
  if (text.toUpperCase().includes('VALIDATED')) {
    return {
      validated: true,
      corrections: null,
      issues: []
    };
  }

  // Parse corrections
  const issues: VisualIssue[] = [];
  const correctionsMatch = text.match(/CORRECTIONS:([\s\S]*)/i);

  if (correctionsMatch) {
    const correctionLines = correctionsMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('-'));

    for (const line of correctionLines) {
      const cleaned = line.replace(/^-\s*/, '').trim();

      // Categorize the issue
      let type: VisualIssue['type'] = 'other';
      if (/overlap/i.test(cleaned)) type = 'overlap';
      else if (/out|bounds|outside/i.test(cleaned)) type = 'out_of_bounds';
      else if (/missing/i.test(cleaned)) type = 'missing_room';
      else if (/dimension|size|proportion/i.test(cleaned)) type = 'wrong_dimensions';

      issues.push({
        type,
        description: cleaned
      });
    }
  }

  return {
    validated: false,
    corrections: text,
    issues
  };
}

/**
 * Get the visual validation prompt
 */
export function getVisualValidationPrompt(): string {
  return VISUAL_VALIDATION_PROMPT;
}

/**
 * Get maximum iterations for visual feedback loop
 */
export function getMaxIterations(): number {
  return MAX_ITERATIONS;
}

/**
 * Get image quality setting
 */
export function getImageQuality(): number {
  return IMAGE_QUALITY;
}

// ============================================================================
// Cost Tracking
// ============================================================================

/** Estimated tokens per image at medium quality */
const TOKENS_PER_IMAGE = 560;

/** Cost per 1K tokens for Gemini 3.0 Pro vision */
const COST_PER_1K_TOKENS = 0.002;

export interface CostEstimate {
  tokens: number;
  costUSD: number;
}

/**
 * Calculate cost estimate for visual feedback
 */
export function estimateVisualFeedbackCost(iterationCount: number): CostEstimate {
  const tokens = TOKENS_PER_IMAGE * iterationCount;
  const costUSD = (tokens / 1000) * COST_PER_1K_TOKENS;

  return {
    tokens,
    costUSD: Math.round(costUSD * 10000) / 10000 // Round to 4 decimal places
  };
}
