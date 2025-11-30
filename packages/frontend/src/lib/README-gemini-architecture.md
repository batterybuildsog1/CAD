# Gemini CAD Integration Architecture

This document describes the two Gemini integration paths and their relationship.

## Two Integration Paths

### 1. Server Path (`GeminiCADClient` in `gemini-cad.ts`)

Used by: `/api/ai/generate` route

- Gemini API calls happen server-side
- Tool execution via HTTP to geometry server
- Full `preValidateToolCall` dependency checking
- Best for: Production deployments, server-rendered apps

### 2. Hybrid Path (`useGeminiCAD` hook)

Used by: `/workspace` page, `/api/ai/chat` proxy

- Gemini API calls go through thin server proxy (API key secure)
- Tool execution happens client-side via WASM (zero latency)
- WASM store shared with 3D renderer (instant visual updates)
- Best for: Interactive apps, real-time feedback

## Shared Modules

To avoid drift between the two paths, common logic is extracted:

| Module | Purpose |
|--------|---------|
| `gemini-prompts.ts` | Goal-oriented prompts, self-verification parsing |
| `gemini-validation.ts` | Unified ValidationStatus, constraint merging |
| `observable-state.ts` | LLM-friendly state, room/wall summaries, constraint checking |
| `cad-skills.ts` | High-level skills (shared by both paths) |

## Configuration (Always Enabled)

Both paths use identical Gemini configuration per `GEMINI_INTEGRATION.md`:

```typescript
{
  model: 'gemini-3-pro-preview',
  config: {
    temperature: 1.0,  // Always 1.0 for architectural creativity
    thinkingConfig: { thinkingBudget: 32768 },  // Always enabled
    // ... tools and system prompt
  }
}
```

## Dependency Validation

- **Raw tools**: Subject to `preValidateToolCall` dependency checking
- **Skills**: Bypass dependency checks (they generate valid sequences internally)
- **Both**: Rust/WASM engine provides final validation safety net

See `cad-skills.ts` module docs for detailed explanation.

## Design Decision: Why Two Paths?

We maintain two paths because they serve different deployment scenarios:

1. **Server path** is simpler for traditional server deployments where you don't want WASM in the browser
2. **Hybrid path** provides the best UX for interactive CAD apps (instant updates, live preview)

The shared modules ensure they don't drift apart on core logic.
