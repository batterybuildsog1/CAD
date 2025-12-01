/**
 * Shared Gemini Prompt Utilities for Svelte 5
 */

// ============================================================================
// Types
// ============================================================================

export interface SelfVerificationReport {
  requirementsMet: 'YES' | 'NO' | 'PARTIAL';
  validationStatus: 'PASSED' | 'FAILED' | 'WARNINGS';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation: 'Proceed' | 'Revise' | 'Request Clarification';
}

// ============================================================================
// Prompt Building
// ============================================================================

export function buildGoalOrientedPrompt(prompt: string, successCriteria: string[]): string {
  const criteriaList = successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n');

  return `${prompt}

GOALS (complete ALL before stopping):
${criteriaList}

EXECUTION:
- Work continuously until ALL goals are achieved.
- Start by understanding the room program and circulation, then derive the shell/footprint dimensions from that plan.
- Only call shell tools (skill_create_house_shell or raw shell tools) **after** you have a tentative program and target interior_width/depth.
- Treat vague gross area targets (e.g., "about 1200 sqft") as a range, not a fixed rectangle; size the shell from summed room areas + circulation.
- When rooms do not depend on each other, emit multiple room-creation tool calls in a single step rather than one at a time.
- A project without rooms and circulation is NOT complete - keep building.
- Only pause for: blocking errors or design trade-offs needing user input.

WHEN FINISHED: Briefly summarize what was created.`;
}

export const DEFAULT_SUCCESS_CRITERIA = [
  'All requested core spaces are created (at least one living area, kitchen, bedrooms, and bathrooms, as implied by the prompt).',
  'There is a circulation path (entries and/or hallways) connecting the main entry to all bedrooms and bathrooms.',
  'The building shell/footprint exists and fully encloses all rooms with reasonable clearances at exterior walls.',
  'Total interior area is reasonable for the described program and any user-provided target (e.g., approximate gross sqft), not wildly under- or oversized.',
  'No validation errors.',
];

// ============================================================================
// Self-Verification Parsing
// ============================================================================

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

export function isGenerationSuccessful(
  selfVerification: SelfVerificationReport | undefined,
  allToolsSucceeded: boolean
): boolean {
  if (selfVerification) {
    return selfVerification.requirementsMet === 'YES';
  }
  return allToolsSucceeded;
}
