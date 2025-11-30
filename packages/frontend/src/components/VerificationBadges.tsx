'use client';

// ============================================================================
// Types
// ============================================================================

interface SelfVerification {
  requirementsMet: 'YES' | 'NO' | 'PARTIAL';
  validationStatus: 'PASSED' | 'FAILED' | 'WARNINGS';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation: 'Proceed' | 'Revise' | 'Request Clarification';
}

interface VerificationBadgesProps {
  verification: SelfVerification;
}

// ============================================================================
// Badge Component
// ============================================================================

function Badge({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: 'success' | 'warning' | 'error' | 'neutral';
}) {
  const variantClasses = {
    success: 'bg-green-900/50 border-green-700 text-green-300',
    warning: 'bg-yellow-900/50 border-yellow-700 text-yellow-300',
    error: 'bg-red-900/50 border-red-700 text-red-300',
    neutral: 'bg-gray-800 border-gray-600 text-gray-300',
  };

  return (
    <div className={`rounded-lg border px-3 py-2 ${variantClasses[variant]}`}>
      <div className="text-xs text-gray-400 uppercase mb-0.5">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

// ============================================================================
// VerificationBadges Component
// ============================================================================

export function VerificationBadges({ verification }: VerificationBadgesProps) {
  // Determine variants for each badge
  const getRequirementsVariant = (): 'success' | 'warning' | 'error' => {
    switch (verification.requirementsMet) {
      case 'YES':
        return 'success';
      case 'PARTIAL':
        return 'warning';
      case 'NO':
        return 'error';
    }
  };

  const getValidationVariant = (): 'success' | 'warning' | 'error' => {
    switch (verification.validationStatus) {
      case 'PASSED':
        return 'success';
      case 'WARNINGS':
        return 'warning';
      case 'FAILED':
        return 'error';
    }
  };

  const getConfidenceVariant = (): 'success' | 'warning' | 'error' => {
    switch (verification.confidence) {
      case 'HIGH':
        return 'success';
      case 'MEDIUM':
        return 'warning';
      case 'LOW':
        return 'error';
    }
  };

  const getRecommendationVariant = (): 'success' | 'warning' | 'error' => {
    switch (verification.recommendation) {
      case 'Proceed':
        return 'success';
      case 'Revise':
        return 'warning';
      case 'Request Clarification':
        return 'error';
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Self-Verification</h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Badge
          label="Requirements Met"
          value={verification.requirementsMet}
          variant={getRequirementsVariant()}
        />
        <Badge
          label="Validation"
          value={verification.validationStatus}
          variant={getValidationVariant()}
        />
        <Badge
          label="Confidence"
          value={verification.confidence}
          variant={getConfidenceVariant()}
        />
        <Badge
          label="Recommendation"
          value={verification.recommendation}
          variant={getRecommendationVariant()}
        />
      </div>
    </div>
  );
}
