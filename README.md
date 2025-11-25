## Antigravity CAD

Antigravity CAD is a **modern, AI-assisted CAD system** focused on building design, structural reasoning, and eventually MEP coordination.  
The stack is built around a **Rust geometry/logic core** with a web frontend and a Python-based AI worker.

### High-Level Architecture

- **Frontend** (`packages/frontend`)
  - Next.js + React + Three.js (via a viewer component).
  - Responsible for the interactive 2D/3D UI, camera controls, selection, and basic editing tools.
  - Communicates with the geometry server over HTTP/JSON (and later WebSockets) to request geometry updates and run operations.

- **Geometry Server (Rust)** (`packages/geometry-server`)
  - Axum-based web server exposing a small HTTP API.
  - Uses **Truck** (Rust B-Rep/NURBS kernel) for precise geometry and meshing.
  - Embeds **Rhai** for sandboxed scripting so that higher-level logic and AI-generated scripts can safely drive modeling.
  - Will host the core domain model for buildings (walls, slabs, rooms, loads, etc.) and versioned edit history.

- **AI Worker (Python)** (`packages/ai-worker`)
  - Python + LangChain + Gemini (or similar).
  - Orchestrates prompts and “tool calls” for design tasks.
  - Translates high-level intents (e.g. “2 story 2500 sqft Scandinavian house”) into safe, structured operations or Rhai scripts for the Rust server.

- **Versioning**
  - No external data layer like Speckle; model history will be managed by the Rust backend (event log + snapshots) and persisted using a storage backend to be defined.

---

### Getting Started (Monorepo)

#### Prerequisites

- **Node.js** 18+
- **Rust** toolchain (for the geometry server)
- **Python 3.10+** and **Poetry** (for the AI worker, optional during early UI/geometry work)

#### Install JS dependencies

```bash
cd /Users/alanknudson/AutoCad_with_Gemini_3_Pro
npm install
```

#### Run the frontend (Next.js)

In one terminal:

```bash
cd /Users/alanknudson/AutoCad_with_Gemini_3_Pro
npx turbo run dev --filter=frontend
```

This will start the Next.js app (by default on `http://localhost:3000`).

#### Run the geometry server (Rust)

In a separate terminal:

```bash
cd /Users/alanknudson/AutoCad_with_Gemini_3_Pro/packages/geometry-server
cargo run
```

This starts the Axum server (currently listening on `127.0.0.1:3001` with a simple `/health` and `/api/v1/execute` route).

#### (Optional) Run the AI worker

In another terminal:

```bash
cd /Users/alanknudson/AutoCad_with_Gemini_3_Pro/packages/ai-worker
poetry install
poetry run python main.py
```

The AI worker is currently a stub entrypoint and will be extended to:

- Maintain prompt templates and tool definitions.
- Call Gemini and translate responses into structured operations or Rhai scripts for the geometry server.

---

### Roadmap (Conceptual)

This repository is being reoriented toward a **house-focused, inspection-adjacent CAD system**. The rough phases are:

For a detailed, phase-by-phase architecture and development plan (including how Rust, Truck, and Rhai interact at each stage), see:

- `docs/architecture.md`

That document covers:

- **Phase 0–1**: Core platform and footprint/layout editing.
- **Phase 2–3**: Structural shell, rooms, openings, and envelope.
- **Phase 4–6**: HVAC, plumbing, and electrical as discrete component graphs.
- **Phase 7**: Integrated checks, clash detection, and reporting.

This README intentionally stays high-level; the `docs/architecture.md` file is the source of truth for the evolving architecture and roadmap.
