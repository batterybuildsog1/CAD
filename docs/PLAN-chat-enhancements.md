# Plan: Chat Panel Enhancements

## Features Requested
1. **Cancel Generation Button** - Stop generation mid-process and clear what was built
2. **Show Thinking Tokens** - Display Gemini's reasoning/thoughts as it works
3. **Token Usage Display** - Show token costs per step and cumulative totals

---

## Analysis

### Current Architecture

**Files involved:**
- `ChatPanelHybrid.tsx` - UI component with Generate button
- `useGeminiCAD.ts` - Hook managing generation loop
- `api/ai/chat/route.ts` - Server proxy to Gemini API

**Current flow:**
1. User clicks "Generate" → `handleGenerate()` → `generate(prompt)`
2. `generate()` loops: call Gemini → execute tools → send results → repeat
3. No way to interrupt the loop once started
4. No thinking output captured from Gemini
5. No token usage tracked

### Gemini API Capabilities (from docs)

**Thinking Output:**
```typescript
config: {
  thinkingConfig: {
    thinkingBudget: 32768,  // Already have this
    includeThoughts: true   // ADD THIS
  }
}
```

Response parts have `part.thought: boolean` - if true, the text is thinking output.

**Token Usage:**
```typescript
response.usageMetadata = {
  promptTokenCount: number,
  candidatesTokenCount: number,
  totalTokenCount: number,
  // May include thinking tokens in total
}
```

---

## Implementation Plan

### 1. Cancel Generation Button

**Problem:** The `generate()` function is an async loop that can't be interrupted.

**Solution:** Use `AbortController` pattern

**Changes:**

A) `useGeminiCAD.ts`:
```typescript
// Add ref to track abort controller
const abortControllerRef = useRef<AbortController | null>(null);

// In generate():
abortControllerRef.current = new AbortController();
const signal = abortControllerRef.current.signal;

// Check signal in loop
while (currentIteration < maxIterations) {
  if (signal.aborted) {
    // User cancelled - return partial result
    break;
  }
  // ... existing loop code
}

// Add cancel function
const cancel = useCallback(() => {
  abortControllerRef.current?.abort();
  setGenerating(false);
}, []);

// Return cancel from hook
return { generate, cancel, ... };
```

B) `ChatPanelHybrid.tsx`:
```typescript
const { generate, cancel, ... } = useGeminiCAD();

// In controls section, conditionally show Cancel button during generation
{generating && (
  <button onClick={handleCancel} className="bg-red-600 hover:bg-red-500">
    Cancel
  </button>
)}
```

C) Add "Clear Results" or change Reset to work better:
- Reset Store: Clears WASM state + levelIds
- Cancel: Stops generation loop, keeps partial results

---

### 2. Show Thinking Tokens

**Problem:** Gemini's thinking output isn't being captured or displayed.

**Solution:** Enable `includeThoughts: true` and extract thought parts from response.

**Changes:**

A) `api/ai/chat/route.ts`:
```typescript
// Update config
config: {
  thinkingConfig: {
    thinkingBudget: 32768,
    includeThoughts: true  // ADD
  },
}

// Extract thoughts from response parts
let thinkingSummary: string | undefined;
for (const part of rawParts) {
  const partAny = part as Record<string, unknown>;
  if (partAny.thought && partAny.text) {
    thinkingSummary = partAny.text as string;
  }
}

// Add to response
return NextResponse.json({
  success: true,
  text: response.text || undefined,
  thinking: thinkingSummary,  // ADD
  functionCalls: ...,
  history: ...,
});
```

B) Update `ChatResponse` interface in both files to include `thinking?: string`

C) `useGeminiCAD.ts`:
```typescript
// Track thinking outputs per iteration
const thinkingOutputsRef = useRef<string[]>([]);

// In loop, capture thinking
if (chatResponse.thinking) {
  thinkingOutputsRef.current.push(chatResponse.thinking);
}

// Add to partial result so UI can display live
const partialResult: GenerationResult = {
  ...
  thinkingOutputs: [...thinkingOutputsRef.current],
};
```

D) `ChatPanelHybrid.tsx`:
```typescript
// Display thinking in collapsible section
{result?.thinkingOutputs?.length > 0 && (
  <details className="bg-purple-900/20 border border-purple-700 rounded-lg p-4">
    <summary className="cursor-pointer text-purple-300 font-semibold">
      🧠 Gemini's Reasoning ({result.thinkingOutputs.length} steps)
    </summary>
    <div className="mt-3 space-y-2">
      {result.thinkingOutputs.map((thought, i) => (
        <div key={i} className="text-sm text-purple-200 whitespace-pre-wrap">
          <span className="text-purple-400">Step {i+1}:</span> {thought}
        </div>
      ))}
    </div>
  </details>
)}
```

---

### 3. Token Usage Display

**Problem:** No token usage information being tracked or displayed.

**Solution:** Extract `usageMetadata` from each Gemini response, track per-step and cumulative.

**Changes:**

A) `api/ai/chat/route.ts`:
```typescript
// Extract usage metadata
const usageMetadata = response.usageMetadata;

return NextResponse.json({
  success: true,
  text: ...,
  thinking: ...,
  functionCalls: ...,
  history: ...,
  usage: usageMetadata ? {
    promptTokens: usageMetadata.promptTokenCount,
    responseTokens: usageMetadata.candidatesTokenCount,
    totalTokens: usageMetadata.totalTokenCount,
  } : undefined,
});
```

B) `useGeminiCAD.ts`:
```typescript
interface TokenUsage {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

// Track per-step and cumulative
const tokenUsageRef = useRef<{
  steps: TokenUsage[];
  cumulative: TokenUsage;
}>({
  steps: [],
  cumulative: { promptTokens: 0, responseTokens: 0, totalTokens: 0 },
});

// In loop, accumulate usage
if (chatResponse.usage) {
  tokenUsageRef.current.steps.push(chatResponse.usage);
  tokenUsageRef.current.cumulative.promptTokens += chatResponse.usage.promptTokens;
  tokenUsageRef.current.cumulative.responseTokens += chatResponse.usage.responseTokens;
  tokenUsageRef.current.cumulative.totalTokens += chatResponse.usage.totalTokens;
}

// Add to GenerationResult
const generationResult: GenerationResult = {
  ...
  tokenUsage: {
    steps: tokenUsageRef.current.steps,
    cumulative: tokenUsageRef.current.cumulative,
  },
};
```

C) `ChatPanelHybrid.tsx`:
```typescript
// Token usage summary card
{result?.tokenUsage && (
  <div className="p-4 bg-gray-800 rounded-lg">
    <h3 className="text-sm font-semibold text-gray-300 mb-2">Token Usage</h3>
    <div className="grid grid-cols-3 gap-4 text-center">
      <div>
        <div className="text-2xl font-bold text-blue-400">
          {result.tokenUsage.cumulative.promptTokens.toLocaleString()}
        </div>
        <div className="text-xs text-gray-400">Input Tokens</div>
      </div>
      <div>
        <div className="text-2xl font-bold text-green-400">
          {result.tokenUsage.cumulative.responseTokens.toLocaleString()}
        </div>
        <div className="text-xs text-gray-400">Output Tokens</div>
      </div>
      <div>
        <div className="text-2xl font-bold text-purple-400">
          {result.tokenUsage.cumulative.totalTokens.toLocaleString()}
        </div>
        <div className="text-xs text-gray-400">Total</div>
      </div>
    </div>

    {/* Per-step breakdown (collapsible) */}
    <details className="mt-3">
      <summary className="text-xs text-gray-400 cursor-pointer">
        Per-step breakdown ({result.tokenUsage.steps.length} API calls)
      </summary>
      <div className="mt-2 text-xs space-y-1">
        {result.tokenUsage.steps.map((step, i) => (
          <div key={i} className="flex justify-between text-gray-400">
            <span>Step {i + 1}:</span>
            <span>{step.totalTokens} tokens</span>
          </div>
        ))}
      </div>
    </details>
  </div>
)}
```

---

## Type Updates Required

`gemini-cad.ts` (GenerationResult interface):
```typescript
export interface GenerationResult {
  success: boolean;
  finalResponse: string;
  toolCallHistory: Array<{ call: ToolCall; result: ObservableToolResult }>;
  checkpointReports: string[];
  selfVerification?: SelfVerificationReport;
  // ADD:
  thinkingOutputs?: string[];
  tokenUsage?: {
    steps: TokenUsage[];
    cumulative: TokenUsage;
  };
}
```

---

## Summary of Changes

| File | Changes |
|------|---------|
| `api/ai/chat/route.ts` | Add `includeThoughts`, extract thinking text, extract usageMetadata |
| `useGeminiCAD.ts` | Add AbortController, track thinking/tokens, add `cancel()` function |
| `ChatPanelHybrid.tsx` | Add Cancel button, thinking display, token usage card |
| `gemini-cad.ts` | Update GenerationResult interface |

---

## Order of Implementation

1. **Token Usage** (simplest, just data extraction)
2. **Thinking Display** (add config flag, extract from response)
3. **Cancel Button** (requires AbortController pattern)

Each can be done incrementally and tested independently.
