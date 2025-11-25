## Antigravity CAD – Frontend

This package contains the **web frontend** for Antigravity CAD.

- Built with **Next.js (App Router)** and **React**.
- Uses **Three.js** (via a custom `Viewer` component) for real-time 3D visualization.
- Talks to the **Rust geometry server** over HTTP/JSON (and later WebSockets).

### Responsibilities

- Render the main **2D/3D viewport**.
- Provide UI for:
  - camera controls (orbit/pan/zoom),
  - selecting and inspecting building elements,
  - sending high-level edit commands (e.g. “create footprint”, “move wall”, “generate option”).
- Display responses from the geometry server (meshes, metadata) and, later, design/analysis feedback from the AI worker.

---

### Getting Started (Frontend Only)

From the repo root:

```bash
cd /Users/alanknudson/AutoCad_with_Gemini_3_Pro
npx turbo run dev --filter=frontend
```

By default, this will start Next.js on `http://localhost:3000`.

You can edit the main entry in `src/app/page.tsx` and the 3D viewport in `src/components/Viewer.tsx`.

---

### Development Notes

- The frontend should treat all geometry as **view state**:
  - authoritative building/structural data will live in the Rust geometry server.
  - the client sends **intents/commands**, not low-level mesh edits.
- As the API for the geometry server stabilizes, we will:
  - add a small **TypeScript SDK** for calling geometry operations,
  - introduce **WebSockets** for streaming updates during interactive edits.

This README is intentionally minimal and focused on this package; see the root `README.md` for the overall system architecture and roadmap.
