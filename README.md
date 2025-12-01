## Antigravity CAD

Antigravity CAD is a **modern, AI-assisted CAD system** focused on building design, structural reasoning, and eventually MEP coordination.  
The stack is built around a **Rust geometry/logic core** with a web frontend and a Python-based AI worker.

### High-Level Architecture

- **Frontend** (`packages/frontend-svelte`)
  - SvelteKit + Svelte 5 + Three.js (Threlte).
  - Loads the **WASM module** to run the CAD engine directly in the browser.
  - Renders 3D geometry using shared memory buffers from WASM.

- **Geometry Core** (`packages/geometry-core`)
  - Pure Rust library containing the domain model, store, and geometry logic.
  - Uses **Truck** (Rust B-Rep/NURBS kernel) for operations.
  - Platform-agnostic (compiles to both WASM and Native).

- **Geometry WASM** (`packages/geometry-wasm`)
  - Rust crate that exposes `geometry-core` to JavaScript via `wasm-bindgen`.
  - Handles data marshalling and mesh generation for the frontend.

- **AI Worker (Python)** (`packages/ai-worker`)
  - Python + LangChain + Gemini 3.0 Pro.
  - Orchestrates design tasks and generates Rhai scripts.

---

### Getting Started

#### Prerequisites
- **Node.js** 18+
- **Rust** toolchain (with `wasm32-unknown-unknown` target)
- **wasm-pack** (`cargo install wasm-pack`)

#### Build WASM Module
```bash
cd packages/geometry-wasm
wasm-pack build --target web
```

#### Run Frontend
```bash
cd packages/frontend-svelte
npm install
npm run dev
```
Open `http://localhost:5173`. The app will load the compiled WASM module.

### Roadmap
See `docs/architecture.md` for the detailed Client-Side WASM architecture.

- **Phase 1**: Core Refactoring & WASM Prep (Completed)
- **Phase 2**: Frontend Integration (WASM Loading & Rendering)
- **Phase 3**: In-Browser Rhai Scripting
