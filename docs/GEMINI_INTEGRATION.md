# Gemini 3.0 Pro Integration Guide

## Purpose

This document defines the integration architecture for **Gemini 3.0 Pro** as the AI backbone for CAD script generation in Antigravity CAD. The core principle is **accuracy through visibility**: Gemini performs best when it can observe the full state of the CAD model and make informed decisions, rather than being constrained by low temperatures or blind retry loops.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Model Configuration](#model-configuration)
3. [Observable State Pattern](#observable-state-pattern)
4. [Thought Signatures](#thought-signatures)
5. [Self-Correction Pattern](#self-correction-pattern)
6. [Checkpoints and Self-Verification](#checkpoints-and-self-verification)
7. [Tool Schema Design](#tool-schema-design)
8. [Structured Output Schema](#structured-output-schema)
9. [Context Caching](#context-caching)
10. [Configuration Reference](#configuration-reference)
11. [Implementation Checklist](#implementation-checklist)
12. [Design Principles](#design-principles)

---

## Architecture Overview

### Observable Feedback Loop

The foundation of our Gemini integration is an **observable feedback loop**, not blind retries:

```
User Request --> Plan --> Execute --> OBSERVE RESULTS --> Self-Verify --> Adjust/Proceed
                                            |
                                    Full State Visibility:
                                    - What was attempted
                                    - What actually happened
                                    - Current CAD state
                                    - Available options
                                    - Validation results
```

**Key Insight**: Gemini 3.0 Pro performs better when it can "see what's going on" and make informed adjustments. Do NOT constrain with `temperature: 0` and blind retries.

### Data Flow

1. User provides a natural language request (e.g., "Create a 5m x 4m room")
2. Gemini generates a plan with checkpoints
3. Each tool call executes against the Rust CAD core
4. Rich feedback returns to Gemini with full observable state
5. Gemini self-verifies against success criteria
6. On error, Gemini receives full context to reason about fixes

---

## Model Configuration

### Critical Settings

```typescript
const model = genAI.getGenerativeModel({
  model: "gemini-3-pro-preview",  // Gemini 3 Pro (November 2025)
  generationConfig: {
    temperature: 1.0,        // CRITICAL: Use 1.0, NOT 0
    thinkingConfig: {
      thinkingBudget: 32768  // Maximum thinking tokens for complex CAD reasoning
    }
  },
  safetySettings: [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  ]
});
```

### Why Temperature 1.0

- Gemini 3.0 Pro has **native reasoning** that works better at standard temperature
- Do NOT use complex chain-of-thought prompting; Gemini 3 handles this internally
- Lower temperatures actually **hurt** reasoning capability in Gemini 3
- Use `thinkingBudget: 32768` for complex spatial reasoning instead of temperature tuning

---

## Observable State Pattern

### Core Concept

Give Gemini full visibility into what is happening. Return rich, structured feedback after every operation.

### Implementation Example

```typescript
// GOOD: Rich feedback that enables informed decisions
function createWallWithObservability(params) {
  const result = rustCore.createWall(params);

  return {
    // What happened
    status: result.success ? "success" : "error",
    wall_id: result.wall_id,

    // What the geometry looks like
    geometry: {
      start: params.start_point,
      end: params.end_point,
      length: calculateLength(params.start_point, params.end_point),
      height: params.height,
      thickness: params.thickness
    },

    // Validation from Rust store
    validation: rustCore.validateGeometry(result.wall_id),

    // Current state of entire CAD model
    observable_state: {
      entities: {
        walls: rustCore.getAllWalls().map(w => ({id: w.id, start: w.start, end: w.end})),
        total_count: rustCore.getEntityCount()
      },
      last_operation: rustCore.getLastOperation(),
      project_bounds: rustCore.getProjectBounds()
    },

    // What changed
    what_changed: `Added wall ${result.wall_id}, total walls: ${getWallCount()}`,

    // What Gemini can do next
    next_options: [
      "Create connecting wall",
      "Add opening to this wall",
      "Validate complete geometry",
      "Query wall properties"
    ]
  };
}
```

### Anti-Pattern

```typescript
// BAD: Minimal feedback that forces blind guessing
{ status: "ok" }
```

**Why Observable State Matters**: Gemini makes better decisions when it can SEE the full context, not guess.

---

## Thought Signatures

### Requirement

Gemini 3.0 Pro requires preserving `thoughtSignature` across multi-turn conversations. Failure to include thought signatures results in a `400 Bad Request` error.

### Implementation

```typescript
const chat = model.startChat({ enableAutomaticFunctionCalling: true });

// First message - Gemini generates tool call with thought signature
const response = await chat.sendMessage("Create a 5m x 4m room");

// The SDK handles thought signatures automatically in ChatSession
// For manual handling, you MUST include thoughtSignature in function responses:
const manualResponse = {
  role: "function",
  parts: [
    {
      functionResponse: {
        name: "create_wall",
        response: { status: "success", id: "wall_001" }
      }
    },
    {
      thoughtSignature: response.thoughtSignature  // MUST include or 400 error
    }
  ]
};
```

**Recommendation**: Use `ChatSession` with `startChat()` which handles thought signatures automatically.

---

## Self-Correction Pattern

### Informed Self-Correction (NOT Blind Retries)

On errors, show Gemini WHAT happened and let it reason about fixes:

```typescript
// On error, provide rich context for self-correction
if (result.error) {
  const errorFeedback = {
    status: "error",

    // What was attempted
    attempted: {
      function: toolCall.name,
      parameters: toolCall.args
    },

    // What actually happened
    error: {
      message: result.error,
      type: result.errorType,
      rust_validation: result.validationDetails
    },

    // Current state (unchanged)
    current_state: getObservableState(),

    // Recovery options (NOT just "retry")
    recovery_options: [
      `Adjust parameters: ${suggestParameterFixes(result.error)}`,
      `Try alternative: ${suggestAlternatives(toolCall)}`,
      "Request clarification from user"
    ],

    // Constraints Gemini should know about
    validation_constraints: {
      wall_thickness: { min: 0.1, max: 0.6, unit: "meters" },
      floor_height: { min: 2.4, max: 4.5, unit: "meters" },
      project_bounds: rustCore.getProjectBounds()
    }
  };

  // Let Gemini reason about the fix with full context
  return chat.sendMessage(JSON.stringify(errorFeedback));
}
```

**Key Difference**: Not "retry 3 times" but "show what went wrong and let model decide how to fix."

---

## Structured Errors

### Overview

The Rust CAD core returns **structured errors** (not simple strings) that Gemini can parse and understand for self-correction. Each error includes:

- **Error Code**: Machine-readable category (e.g., `ENTITY_NOT_FOUND`, `PARAMETER_OUT_OF_RANGE`)
- **Message**: Human-readable description
- **Context**: Entity type, ID, field that caused the error
- **Suggestions**: Possible fixes or next steps

### Error Codes

| Code | Description | Example |
|------|-------------|---------|
| `ENTITY_NOT_FOUND` | Referenced entity doesn't exist | `Wall not found` |
| `ENTITY_ALREADY_EXISTS` | Entity already created | `Grid already exists for building` |
| `INVALID_PARAMETER` | Parameter has wrong type/format | `Unknown unit system: fathoms` |
| `PARAMETER_OUT_OF_RANGE` | Value outside valid bounds | `position must be 0.0-1.0` |
| `INVALID_GEOMETRY` | Geometry format wrong | `Invalid point format` |
| `DEGENERATE_GEOMETRY` | Geometry too small/collapsed | `Polygon requires ≥3 points` |
| `VALIDATION_FAILED` | Constraint violated | `Invalid polygon: non-closed` |

### Example Structured Error

```json
{
  "code": "PARAMETER_OUT_OF_RANGE",
  "message": "position is out of valid range",
  "entity_type": "opening",
  "field": "position",
  "provided_value": "1.5",
  "valid_range": "0 to 1",
  "suggestions": [
    "Use a value in range: 0 to 1"
  ]
}
```

### Implementation (Rust)

Structured errors are defined in `packages/geometry-core/src/domain/error.rs`:

```rust
pub struct StructuredError {
    pub code: ErrorCode,
    pub message: String,
    pub entity_type: Option<EntityType>,
    pub entity_id: Option<String>,
    pub field: Option<String>,
    pub provided_value: Option<String>,
    pub valid_range: Option<String>,
    pub suggestions: Vec<String>,
}

// Usage example
StructuredError::parameter_out_of_range("position", 1.5, Some(0.0), Some(1.0))
```

**Why Structured Errors Matter**: Gemini can parse error details (field, valid range, suggestions) to understand exactly how to fix the issue, rather than guessing from a generic error message.

---

## Checkpoints and Self-Verification

### Goal-Oriented Prompts

Break complex tasks into verifiable checkpoints with explicit success criteria:

```typescript
const GOAL_ORIENTED_PROMPT = `
Create a rectangular room 5m x 4m x 3m.

SUCCESS CRITERIA (verify each):
1. [ ] Four walls created forming closed rectangle
2. [ ] All walls have height 3m
3. [ ] Wall connection gaps < 0.01m
4. [ ] Rust geometry validation passes
5. [ ] No intersections with existing entities

CHECKPOINTS:
- CHECKPOINT 1: Plan coordinates, verify feasibility
- CHECKPOINT 2-5: Create each wall with validation
- CHECKPOINT 6: Final validation and self-verification

AFTER EACH CHECKPOINT report:
- Status: SUCCESS / FAILED
- Validation results from Rust store
- Progress: N/6 checkpoints complete
- Confidence: HIGH / MEDIUM / LOW

AT COMPLETION provide:
\`\`\`
SELF-VERIFICATION REPORT
+-- Requirements Met: [YES/NO/PARTIAL]
+-- Rust Validation: [PASSED/FAILED/WARNINGS]
+-- Geometry Valid: [YES/NO]
+-- Confidence: [HIGH/MEDIUM/LOW]
+-- Recommendation: [Proceed/Revise/Request Clarification]
\`\`\`
`;
```

**Why**: Model verifies its own work against explicit criteria, catching errors before the user sees them.

---

## Tool Schema Design

### Structured Tool Calling

Instead of generating raw Rhai scripts, use **function calling** with strict JSON schemas:

```typescript
const tools = [
  {
    name: "create_project",
    description: "Create a new CAD project",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        units: { enum: ["imperial", "metric"] },
        code_region: { enum: ["US_IRC_2021", "US_IBC_2021"] }
      },
      required: ["name", "units", "code_region"]
    }
  },
  {
    name: "add_level",
    description: "Add a floor level to a building",
    parameters: {
      type: "object",
      properties: {
        building_id: { type: "string" },
        name: { type: "string" },
        elevation: { type: "number", minimum: -50, maximum: 500 },
        floor_to_floor: { type: "number", minimum: 7, maximum: 20 }
      },
      required: ["building_id", "name", "elevation", "floor_to_floor"]
    }
  }
  // ... all 28 Rhai functions as tools
];
```

**Why**: JSON Schema enforcement catches type errors before execution.

### Pre-Execution Validation

```typescript
function validateToolCall(call: ToolCall): ValidationResult {
  // Check dependency order
  if (call.name === "create_wall" && !state.hasLevel(call.params.level_id)) {
    return { valid: false, error: "Level must exist before creating wall" };
  }

  // Check geometric constraints
  if (call.name === "create_room") {
    const polygon = call.params.points;
    if (!isValidPolygon(polygon)) {
      return { valid: false, error: "Room boundary must be a valid closed polygon" };
    }
  }

  return { valid: true };
}
```

---

## Structured Output Schema

### Guaranteed JSON Responses

Define exact output schema to guarantee parseable responses:

```typescript
const responseSchema = {
  type: "object",
  properties: {
    plan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          step: { type: "integer" },
          action: { type: "string" },
          function: { type: "string", enum: RHAI_FUNCTION_NAMES },
          parameters: { type: "object" },
          rationale: { type: "string" }
        },
        required: ["step", "action", "function", "parameters"]
      }
    },
    validation: {
      type: "object",
      properties: {
        dependencies_checked: { type: "boolean" },
        dimensions_validated: { type: "boolean" },
        order_correct: { type: "boolean" }
      }
    }
  },
  required: ["plan", "validation"]
};

const model = genAI.getGenerativeModel({
  model: "gemini-3-pro-preview",
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: responseSchema
  }
});
```

**Why**: JSON Schema in output guarantees parseable, type-safe responses every time.

---

## Context Caching

### Cost Reduction for Repeated Calls

Cache the Rhai API documentation for cheaper repeated calls:

```typescript
const cache = await cacheManager.create({
  model: "gemini-3-pro-preview",
  displayName: "antigravity-cad-api",
  systemInstruction: CAD_SYSTEM_PROMPT,
  contents: [
    { role: "user", parts: [{ text: RHAI_API_DOCUMENTATION }] },
    { role: "model", parts: [{ text: "I understand the 28 Rhai functions." }] }
  ],
  ttlSeconds: 86400  // 24 hours
});

// Use cached context for all subsequent calls
const model = genAI.getGenerativeModelFromCachedContent(cache);
```

**Why**: Caching ~50KB of API docs reduces input token costs by 75% on repeated calls.

---

## Configuration Reference

### Recommended Settings

| Setting | Value | Rationale |
|---------|-------|-----------|
| **Model** | `gemini-3-pro-preview` | Gemini 3 Pro (November 2025 preview) |
| **Temperature** | `1.0` | CRITICAL: Do NOT lower. Gemini 3 reasoning works best here. |
| **Thinking Budget** | `32768` | Maximum reasoning for complex CAD spatial logic |
| **Tool Config** | `AUTO` | Let model decide when to use tools (recommended default) |
| **Chat Session** | Required | Use `startChat()` for automatic thought signature handling |
| **Safety Settings** | `BLOCK_NONE` (all) | Technical code requires no content filtering |

### Anti-Patterns (What NOT to Do)

| Anti-Pattern | Why It Is Wrong |
|--------------|-----------------|
| `temperature: 0.0` | Hurts Gemini 3's native reasoning capability |
| Blind retry loops | Model cannot learn from errors without context |
| Complex chain-of-thought prompts | Gemini 3 handles reasoning internally |
| Manual thought signature handling | Use ChatSession SDK which handles automatically |
| Minimal tool responses | Model needs full state visibility to make good decisions |

---

## Implementation Checklist

### Step 1: Define All 28 Tools with Strict Schemas

- [ ] Map each Rhai function to a Gemini tool
- [ ] Add constraints: `minimum`, `maximum`, `enum`, `pattern`
- [ ] Include detailed descriptions with examples

### Step 2: Create System Prompts

```markdown
## CAD Generation System Prompt

You are an expert architectural CAD script generator.

RULES:
1. ALWAYS plan before generating
2. Create entities in order: Project -> Building -> Level -> Footprint -> Walls -> Openings
3. Use realistic dimensions (feet for Imperial):
   - Room widths: 8-30 ft
   - Wall heights: 8-12 ft
   - Door widths: 2.5-3.5 ft
4. Validate your plan before execution
5. If unsure, ask for clarification

NEVER:
- Generate coordinates without thinking about layout
- Create walls before levels exist
- Use negative dimensions
```

### Step 3: Build Validation Functions

- [ ] Pre-execution validation for dependency order
- [ ] Geometric constraint validation
- [ ] Rich error feedback formatting

### Step 4: Implement Feedback Loop

- [ ] Capture execution errors from Rust core
- [ ] Format errors with full context for LLM understanding
- [ ] Include what was attempted and why it failed
- [ ] Limit retries to prevent infinite loops

### Step 5: Key Files to Create/Modify

| File | Action | Status | Purpose |
|------|--------|--------|---------|
| `packages/frontend/lib/gemini-cad.ts` | NEW | ✅ DONE | Core Gemini client with observable state pattern |
| `packages/frontend/lib/gemini-tools.ts` | NEW | ✅ DONE | All 26 CAD tool definitions with Type schemas |
| `packages/frontend/lib/gemini-types.ts` | NEW | ✅ DONE | TypeScript types for tool calls and responses |
| `packages/frontend/lib/api-tool-executor.ts` | NEW | ✅ DONE | HTTP executor mapping tools to REST API |
| `packages/frontend/src/app/api/ai/generate/route.ts` | NEW | ✅ DONE | Next.js API route for generation |
| `packages/geometry-core/src/domain/error.rs` | NEW | ✅ DONE | Structured error types for AI feedback |
| `packages/geometry-core/src/rhai_api/mod.rs` | MODIFY | ✅ DONE | Updated with structured error returns |

### Success Criteria

- [ ] Zero type errors (JSON Schema catches all)
- [ ] Zero dependency order errors (pre-validation)
- [ ] < 5% retry rate on simple requests
- [ ] < 15% retry rate on complex requests (multi-room houses)
- [ ] All generated scripts execute successfully after validation

---

## Design Principles

### Accuracy Through Visibility

| Principle | Implementation |
|-----------|----------------|
| **Gemini sees everything** | Rich observable state after every operation |
| **Informed decisions** | Show what happened, not just success/fail |
| **Self-verification** | Model checks own work against explicit criteria |
| **Checkpoints not retries** | Break tasks into verifiable steps |
| **Native reasoning** | Use thinkingBudget, not temperature hacks |

### Accepted Trade-offs

| Trade-off | Accepted | Rationale |
|-----------|----------|-----------|
| Verbose tool responses | Yes | Full state visibility enables better decisions |
| Multi-turn conversations | Yes | Thought signatures require ChatSession |
| Higher token usage | Yes | Observable state + thinking budget |
| Complexity in tool implementations | Yes | Rich feedback requires more code |

---

## Related Documentation

- [Architecture Overview](./architecture.md) - Core system architecture
- [Implementation Guide](./implementation-guide.md) - Step-by-step implementation details
