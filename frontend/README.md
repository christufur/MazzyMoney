# Mazzy Money frontend

React 19 + TypeScript + Tailwind, built and served with [Vite](https://vite.dev). Packages are installed with [Bun](https://bun.sh).

## Scripts

```bash
bun install       # install dependencies
bun run dev       # dev server on http://localhost:3000, proxies /api to localhost:8000
bun run build     # production build to dist/
bun run preview   # serve the production build
bun run typecheck # tsc --noEmit
bun run test      # vitest run (jsdom)
```

## API base URL

`src/services/api.ts` reads `import.meta.env.VITE_API_URL`, which is empty by default so requests go to relative `/api` paths:

- **Dev:** the Vite dev server proxies `/api` to `http://localhost:8000`.
- **Production:** the frontend is served next to the API, so relative `/api` works.

To point at a different API host, copy `.env.example` to `.env.local` and set `VITE_API_URL`. Only `VITE_`-prefixed variables reach the client bundle.

## Layout

- `index.html` is the Vite entry point (it loads `/src/index.tsx`).
- `src/components/` holds shared UI (layout, auth forms, charts, transaction widgets).
- `src/pages/` holds the routed pages: `Overview`, `Transactions`, `Budgets`, `Insights`. `Accounts` is kept for later work.
- `src/test/setup.ts` loads `@testing-library/jest-dom` for Vitest.
