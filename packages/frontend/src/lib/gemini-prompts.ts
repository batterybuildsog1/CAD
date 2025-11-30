/**
 * Shared Gemini Prompt Utilities
 *
 * This module provides shared utilities for building prompts and parsing
 * self-verification reports. Used by both the server-side GeminiCADClient
 * and the client-side useGeminiCAD hook to avoid code drift.
 *
 * @see docs/GEMINI_INTEGRATION.md
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Self-verification report parsed from Gemini's final response
 */
export interface SelfVerificationReport {
  requirementsMet: 'YES' | 'NO' | 'PARTIAL';
  validationStatus: 'PASSED' | 'FAILED' | 'WARNINGS';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation: 'Proceed' | 'Revise' | 'Request Clarification';
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build a goal-oriented prompt with success criteria.
 *
 * This is the standard prompt format for CAD generation tasks.
 * It includes:
 * - The user's prompt
 * - A checklist of success criteria
 * - Instructions for execution and self-verification
 *
 * @param prompt - The user's natural language request
 * @param successCriteria - Array of criteria to verify upon completion
 * @returns A formatted goal-oriented prompt
 */
export function buildGoalOrientedPrompt(prompt: string, successCriteria: string[]): string {
  const criteriaList = successCriteria.map((c, i) => `${i + 1}. [ ] ${c}`).join('\n');

  return `${prompt}

SUCCESS CRITERIA (verify each):
${criteriaList}

INSTRUCTIONS:
- Plan all operations before starting
- Execute one operation at a time
- After each operation, verify the observable state
- Report any validation warnings immediately
- After completing all operations, provide a self-verification report

AT COMPLETION provide:
\`\`\`
SELF-VERIFICATION REPORT
Requirements Met: [YES/NO/PARTIAL]
Validation Status: [PASSED/FAILED/WARNINGS]
Confidence: [HIGH/MEDIUM/LOW]
Recommendation: [Proceed/Revise/Request Clarification]
\`\`\``;
}

/**
 * Default success criteria for CAD generation when none are specified
 */
export const DEFAULT_SUCCESS_CRITERIA = [
  'All requested entities created successfully',
  'No validation errors',
  'Geometry is valid',
];

// ============================================================================
// Self-Verification Parsing
// ============================================================================

/**
 * Parse a self-verification report from Gemini's final response.
 *
 * Extracts the structured report from the free-form text response.
 * Returns undefined if no valid report is found.
 *
 * @param response - The final text response from Gemini
 * @returns Parsed self-verification report, or undefined if not found
 */
export function parseSelfVerification(response: string): SelfVerificationReport | undefined {
  const reportMatch = response.match(
    /SELF-VERIFICATION REPORT[\s\S]*?Requirements Met:\s*(YES|NO|PARTIAL)[\s\S]*?Validation Status:\s*(PASSED|FAILED|WARNINGS)[\s\S]*?Confidence:\s*(HIGH|MEDIUM|LOW)[\s\S]*?Recommendation:\s*(Proceed|Revise|Request Clarification)/i
  );

  if (reportMatch) {
    return {
      requirementsMet: reportMatch[1].toUpperCase() as 'YES' | 'NO' | 'PARTIAL',
      validationStatus: reportMatch[2].toUpperCase() as 'PASSED' | 'FAILED' | 'WARNINGS',
      confidence: reportMatch[3].toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW',
      recommendation: reportMatch[4] as 'Proceed' | 'Revise' | 'Request Clarification',
    };
  }

  return undefined;
}

/**
 * Check if a generation was successful based on self-verification or tool history.
 *
 * @param selfVerification - Parsed self-verification report (if any)
 * @param allToolsSucceeded - Whether all tool calls succeeded
 * @returns Whether the generation should be considered successful
 */
export function isGenerationSuccessful(
  selfVerification: SelfVerificationReport | undefined,
  allToolsSucceeded: boolean
): boolean {
  // If we have a self-verification report, trust its assessment
  if (selfVerification) {
    return selfVerification.requirementsMet === 'YES';
  }
  // Otherwise, fall back to checking if all tool calls succeeded
  return allToolsSucceeded;
}
