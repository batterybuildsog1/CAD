# Plan: Chat Panel Enhancements

## Features Requested
1. **Cancel Generation Button** - Stop generation mid-process and clear what was built
2. **Show Thinking Tokens** - Display Gemini's reasoning/thoughts as it works
3. **Token Usage Display** - Show token costs per step and cumulative totals

---

## Analysis

### Current Architecture

**Files involved:**
- `ChatPanel.svelte` - UI component with Generate button
- `gemini-cad.svelte.ts` - Svelte store managing generation loop
- `api/ai/chat/+server.ts` - SvelteKit server route to Gemini API

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
    thinkingLevel: 'high',  // 'low' | 'medium' | 'high'
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

A) `gemini-cad.svelte.ts`:
```typescript
// Add variable to track abort controller
let abortController: AbortController | null = $state(null);

// In generate():
abortController = new AbortController();
const signal = abortController.signal;

// Check signal in loop
while (currentIteration < maxIterations) {
  if (signal.aborted) {
    // User cancelled - return partial result
    break;
  }
  // ... existing loop code
}

// Add cancel function
function cancel() {
  abortController?.abort();
  generating = false;
}

// Export from store
return { generate, cancel, ... };
```

B) `ChatPanel.svelte`:
```svelte
<script lang="ts">
  const { generate, cancel, generating } = geminiCadStore;
</script>

<!-- In controls section, conditionally show Cancel button during generation -->
{#if $generating}
  <button onclick={cancel} class="bg-red-600 hover:bg-red-500">
    Cancel
  </button>
{/if}
```

C) Add "Clear Results" or change Reset to work better:
- Reset Store: Clears WASM state + levelIds
- Cancel: Stops generation loop, keeps partial results

---

### 2. Show Thinking Tokens

**Problem:** Gemini's thinking output isn't being captured or displayed.

**Solution:** Enable `includeThoughts: true` and extract thought parts from response.

**Changes:**

A) `api/ai/chat/+server.ts`:
```typescript
// Update config
config: {
  thinkingConfig: {
    thinkingLevel: 'high',  // 'low' | 'medium' | 'high'
    includeThoughts: true   // ADD
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
return json({
  success: true,
  text: response.text || undefined,
  thinking: thinkingSummary,  // ADD
  functionCalls: ...,
  history: ...,
});
```

B) Update `ChatResponse` interface in both files to include `thinking?: string`

C) `gemini-cad.svelte.ts`:
```typescript
// Track thinking outputs per iteration
let thinkingOutputs: string[] = $state([]);

// In loop, capture thinking
if (chatResponse.thinking) {
  thinkingOutputs = [...thinkingOutputs, chatResponse.thinking];
}

// Add to partial result so UI can display live
const partialResult: GenerationResult = {
  ...
  thinkingOutputs: thinkingOutputs,
};
```

D) `ChatPanel.svelte`:
```svelte
<!-- Display thinking in collapsible section -->
{#if result?.thinkingOutputs?.length > 0}
  <details class="bg-purple-900/20 border border-purple-700 rounded-lg p-4">
    <summary class="cursor-pointer text-purple-300 font-semibold">
      Gemini's Reasoning ({result.thinkingOutputs.length} steps)
    </summary>
    <div class="mt-3 space-y-2">
      {#each result.thinkingOutputs as thought, i}
        <div class="text-sm text-purple-200 whitespace-pre-wrap">
          <span class="text-purple-400">Step {i+1}:</span> {thought}
        </div>
      {/each}
    </div>
  </details>
{/if}
```

---

### 3. Token Usage Display

**Problem:** No token usage information being tracked or displayed.

**Solution:** Extract `usageMetadata` from each Gemini response, track per-step and cumulative.

**Changes:**

A) `api/ai/chat/+server.ts`:
```typescript
// Extract usage metadata
const usageMetadata = response.usageMetadata;

return json({
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

B) `gemini-cad.svelte.ts`:
```typescript
interface TokenUsage {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

// Track per-step and cumulative
let tokenUsageSteps: TokenUsage[] = $state([]);
let tokenUsageCumulative: TokenUsage = $state({ promptTokens: 0, responseTokens: 0, totalTokens: 0 });

// In loop, accumulate usage
if (chatResponse.usage) {
  tokenUsageSteps = [...tokenUsageSteps, chatResponse.usage];
  tokenUsageCumulative = {
    promptTokens: tokenUsageCumulative.promptTokens + chatResponse.usage.promptTokens,
    responseTokens: tokenUsageCumulative.responseTokens + chatResponse.usage.responseTokens,
    totalTokens: tokenUsageCumulative.totalTokens + chatResponse.usage.totalTokens,
  };
}

// Add to GenerationResult
const generationResult: GenerationResult = {
  ...
  tokenUsage: {
    steps: tokenUsageSteps,
    cumulative: tokenUsageCumulative,
  },
};
```

C) `ChatPanel.svelte`:
```svelte
<!-- Token usage summary card -->
{#if result?.tokenUsage}
  <div class="p-4 bg-gray-800 rounded-lg">
    <h3 class="text-sm font-semibold text-gray-300 mb-2">Token Usage</h3>
    <div class="grid grid-cols-3 gap-4 text-center">
      <div>
        <div class="text-2xl font-bold text-blue-400">
          {result.tokenUsage.cumulative.promptTokens.toLocaleString()}
        </div>
        <div class="text-xs text-gray-400">Input Tokens</div>
      </div>
      <div>
        <div class="text-2xl font-bold text-green-400">
          {result.tokenUsage.cumulative.responseTokens.toLocaleString()}
        </div>
        <div class="text-xs text-gray-400">Output Tokens</div>
      </div>
      <div>
        <div class="text-2xl font-bold text-purple-400">
          {result.tokenUsage.cumulative.totalTokens.toLocaleString()}
        </div>
        <div class="text-xs text-gray-400">Total</div>
      </div>
    </div>

    <!-- Per-step breakdown (collapsible) -->
    <details class="mt-3">
      <summary class="text-xs text-gray-400 cursor-pointer">
        Per-step breakdown ({result.tokenUsage.steps.length} API calls)
      </summary>
      <div class="mt-2 text-xs space-y-1">
        {#each result.tokenUsage.steps as step, i}
          <div class="flex justify-between text-gray-400">
            <span>Step {i + 1}:</span>
            <span>{step.totalTokens} tokens</span>
          </div>
        {/each}
      </div>
    </details>
  </div>
{/if}
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
| `api/ai/chat/+server.ts` | Add `includeThoughts`, extract thinking text, extract usageMetadata |
| `gemini-cad.svelte.ts` | Add AbortController, track thinking/tokens, add `cancel()` function |
| `ChatPanel.svelte` | Add Cancel button, thinking display, token usage card |
| `gemini-types.ts` | Update GenerationResult interface |

---

## Order of Implementation

1. **Token Usage** (simplest, just data extraction)
2. **Thinking Display** (add config flag, extract from response)
3. **Cancel Button** (requires AbortController pattern)

Each can be done incrementally and tested independently.
