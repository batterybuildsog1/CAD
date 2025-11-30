'use client';

// ============================================================================
// Types
// ============================================================================

interface TierReasoning {
  tier: 'minimum' | 'nice' | 'extra';
  dimensions?: { width: number; depth: number };
  sqft?: number;
  features?: string[];
  why: string;
  source?: string;
}

interface TierReasoningCardProps {
  reasoning: TierReasoning;
}

// ============================================================================
// TierReasoningCard Component
// ============================================================================

export function TierReasoningCard({ reasoning }: TierReasoningCardProps) {
  const tierConfig = {
    minimum: {
      color: 'orange',
      bgClass: 'bg-orange-900/30',
      borderClass: 'border-orange-700',
      badgeClass: 'bg-orange-600 text-white',
      textClass: 'text-orange-300',
      label: 'MINIMUM',
      description: 'Budget-focused, code-compliant basics',
    },
    nice: {
      color: 'blue',
      bgClass: 'bg-blue-900/30',
      borderClass: 'border-blue-700',
      badgeClass: 'bg-blue-600 text-white',
      textClass: 'text-blue-300',
      label: 'NICE',
      description: 'Balanced comfort and value',
    },
    extra: {
      color: 'purple',
      bgClass: 'bg-purple-900/30',
      borderClass: 'border-purple-700',
      badgeClass: 'bg-purple-600 text-white',
      textClass: 'text-purple-300',
      label: 'EXTRA',
      description: 'Premium features and finishes',
    },
  };

  const config = tierConfig[reasoning.tier];

  return (
    <div className={`rounded-lg border ${config.borderClass} ${config.bgClass} p-4`}>
      {/* Header with tier badge */}
      <div className="flex items-center gap-3 mb-3">
        <span className={`px-2 py-1 rounded text-xs font-bold ${config.badgeClass}`}>{config.label}</span>
        <span className="text-sm text-gray-400">{config.description}</span>
      </div>

      {/* Dimensions and sqft */}
      {(reasoning.dimensions || reasoning.sqft) && (
        <div className="flex items-center gap-4 mb-3">
          {reasoning.dimensions && (
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
              <span className="text-sm text-gray-300">
                {reasoning.dimensions.width}' × {reasoning.dimensions.depth}'
              </span>
            </div>
          )}
          {reasoning.sqft && (
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                />
              </svg>
              <span className="text-sm text-gray-300">{reasoning.sqft} sqft</span>
            </div>
          )}
        </div>
      )}

      {/* Features list */}
      {reasoning.features && reasoning.features.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Features</h4>
          <ul className="space-y-1">
            {reasoning.features.map((feature, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                <span className={config.textClass}>•</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* WHY explanation */}
      <div className="mt-3 pt-3 border-t border-gray-700/50">
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          WHY
        </h4>
        <p className={`text-sm ${config.textClass}`}>{reasoning.why}</p>
      </div>

      {/* Source link */}
      {reasoning.source && (
        <div className="mt-2">
          <span className="text-xs text-gray-500">Source: {reasoning.source}</span>
        </div>
      )}
    </div>
  );
}
