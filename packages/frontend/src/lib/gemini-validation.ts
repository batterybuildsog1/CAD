/**
 * Shared Validation Pipeline for Gemini CAD
 *
 * This module centralizes all validation logic so both the server-side
 * GeminiCADClient and client-side useGeminiCAD hook use the same rules.
 *
 * Validation combines:
 * 1. Engine validation (geometry errors from Rust/WASM)
 * 2. Constraint validation (domain rules from observable-state.ts)
 *
 * @see docs/GEMINI_INTEGRATION.md
 */

import type { ObservableState as NewObservableState } from './observable-state';

// ============================================================================
// Types
// ============================================================================

/**
 * Unified validation status combining engine and constraint checks.
 */
export interface ValidationStatus {
  /** Whether geometry is valid (no engine errors) */
  geometryValid: boolean;
  /** Warning messages (non-blocking issues) */
  warnings: string[];
  /** Error messages (blocking issues) */
  errors: string[];
}

// ============================================================================
// Validation Derivation
// ============================================================================

/**
 * Derive ValidationStatus from the LLM-friendly observable state.
 *
 * Converts the constraint-based format (satisfied/violated/warnings) to the
 * unified ValidationStatus format (geometryValid/warnings/errors).
 *
 * @param llmState - The observable state maintained for LLM context
 * @returns Unified ValidationStatus
 */
export function deriveValidationStatusFromLLMState(
  llmState: NewObservableState | undefined
): ValidationStatus {
  // If no state yet, return clean validation
  if (!llmState?.constraints) {
    return { geometryValid: true, warnings: [], errors: [] };
  }

  const errors = llmState.constraints.violated ?? [];
  const warnings = llmState.constraints.warnings ?? [];

  return {
    geometryValid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Merge engine validation with constraint validation.
 *
 * Engine validation comes from the geometry engine (Rust/WASM).
 * Constraint validation comes from domain rules (room sizes, adjacencies).
 *
 * @param engineStatus - Validation from geometry engine
 * @param constraintStatus - Validation from domain constraints
 * @returns Combined ValidationStatus
 */
export function mergeValidationStatus(
  engineStatus: ValidationStatus,
  constraintStatus: ValidationStatus
): ValidationStatus {
  // Combine warnings and errors, deduplicating
  const mergedWarnings = [...new Set([
    ...engineStatus.warnings,
    ...constraintStatus.warnings,
  ])];

  const mergedErrors = [...new Set([
    ...engineStatus.errors,
    ...constraintStatus.errors,
  ])];

  return {
    geometryValid: engineStatus.geometryValid && constraintStatus.geometryValid && mergedErrors.length === 0,
    warnings: mergedWarnings,
    errors: mergedErrors,
  };
}

/**
 * Create an empty/clean validation status.
 *
 * Use when initializing state or when no validation has been performed.
 */
export function createEmptyValidationStatus(): ValidationStatus {
  return {
    geometryValid: true,
    warnings: [],
    errors: [],
  };
}

/**
 * Create a validation status from an error.
 *
 * @param errorMessage - The error message
 * @returns ValidationStatus with the error
 */
export function createErrorValidationStatus(errorMessage: string): ValidationStatus {
  return {
    geometryValid: false,
    warnings: [],
    errors: [errorMessage],
  };
}

/**
 * Check if validation passed (no errors).
 */
export function isValidationPassed(status: ValidationStatus): boolean {
  return status.geometryValid && status.errors.length === 0;
}

/**
 * Check if validation has warnings (but no errors).
 */
export function hasValidationWarnings(status: ValidationStatus): boolean {
  return status.warnings.length > 0 && status.errors.length === 0;
}
