# Frontend Agent Notes

This is a Vite/React/TypeScript frontend fully wired to a real FastAPI backend — `src/api/governanceApi.ts` is the API client almost every page and hook calls through. This is not a mock-data prototype.

Expected structure:

- `src/components/layout`
- `src/components/ui`
- `src/pages`
- `src/data`
- `src/types`
- `src/store`

Use TailwindCSS utility classes, lucide-react icons, Recharts for charts, React Flow for pipeline diagrams, and Zustand for lightweight UI state.

`src/data/` holds static/mock data. Treat it strictly as a documented fallback for when the backend is unreachable — never wire a new feature to it as the default data source.
