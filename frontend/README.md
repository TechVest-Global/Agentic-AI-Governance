# GovernAI — Frontend

A React + TypeScript + Vite prototype for an **Enterprise GenAI Governance Engine** — an output-only AI governance console that audits production AI models the way a risk committee would: parallel specialist detection, a deliberation council with forced dissent, confidence-bounded actions, and a hash-chained, append-only audit trail.

> This package is the web UI. It runs entirely on **mock data** and does not require the backend to be running.

## Tech stack

| Area | Library |
| --- | --- |
| Framework | React 19 |
| Language | TypeScript 5 |
| Build tool | Vite 8 |
| Styling | TailwindCSS 4 |
| Icons | lucide-react |
| Charts | Recharts |
| Graphs / flows | @xyflow/react (React Flow) |
| Animation | Framer Motion |
| State | Zustand |

## Prerequisites

- **Node.js** `>= 20.19` (or `>= 22.12`) — required by Vite 8
- **npm** `>= 10` (ships with the Node versions above)

Check your versions:

```bash
node -v
npm -v
```

## Getting started

```bash
# 1. Clone the repository
git clone https://github.com/TechVest-Global/Agentic-AI-Governance.git
cd Agentic-AI-Governance/frontend

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

The dev server runs at **http://127.0.0.1:3000** (fixed host/port — see `package.json`).

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with hot reload at `127.0.0.1:3000` |
| `npm run build` | Type-check (`tsc --noEmit`) and produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint over `src` |

## Project structure

```text
frontend/
├─ public/
│  └─ aegis-governance-engine.html   # Standalone interactive engine, embedded via iframe
├─ src/
│  ├─ components/
│  │  ├─ layout/                     # App shell (sidebar, top bar, page chrome)
│  │  └─ ui/                         # Reusable UI primitives (Card, Badge, MetricCard, …)
│  ├─ pages/                         # One module per console screen
│  │  ├─ Dashboard.tsx
│  │  ├─ AISystems.tsx
│  │  ├─ GovernanceEngine.tsx
│  │  ├─ AgentIntelligence.tsx
│  │  ├─ MetricPlan.tsx
│  │  ├─ CouncilDeliberation.tsx
│  │  ├─ Verdicts.tsx
│  │  ├─ LiveRuns.tsx
│  │  ├─ Reports.tsx
│  │  ├─ ToolStack.tsx
│  │  └─ AuditLedger.tsx
│  ├─ data/                          # Mock data and fixtures
│  ├─ store/                         # Zustand store (routing + UI state)
│  └─ types/                         # Shared TypeScript types
└─ package.json
```

## Notes

- All data is mocked in `src/data` — no API keys or backend services are needed to run the UI.
- The repository root is a monorepo that also contains a Python `backend/`. See the root `README.md` for full-stack setup.
