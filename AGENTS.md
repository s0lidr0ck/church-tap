# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Church Tap is a Node.js/Express NFC-powered church engagement platform with a PostgreSQL database. It is a monolithic app (not a monorepo) serving server-rendered HTML pages with Tailwind CSS.

### Services

| Service | Port | Purpose |
|---------|------|---------|
| Express dev server (`npm run dev`) | 3000 | Main app (uses nodemon for hot-reload) |
| PostgreSQL | 5432 | Primary database |

### Database

- PostgreSQL must be running before starting the app: `sudo pg_ctlcluster 16 main start`
- `DATABASE_URL` is set in `~/.bashrc` (points to the local `churchtap` database on port 5432)
- Schema init: `npm run db:init` (idempotent, uses `CREATE TABLE IF NOT EXISTS`)
- Seed data: `npm run setup` (creates default org, master admin, org admin, and sample verse)

### Running the dev server

```bash
npm run dev
```

This starts `nodemon server.js` on port 3000. Requires `DATABASE_URL` in the environment and PostgreSQL running.

### Building CSS

`npm run build:css:once` builds Tailwind CSS. Use `npm run build:css` for watch mode during active CSS development.

### Default credentials

- **Master Admin**: `master` / `master123` (login at `/master`)
- **Organization Admin**: `admin` / `admin123` (login at `/admin`)

### Key access URLs

- Public verse page: `http://localhost:3000/verse`
- Admin dashboard: `http://localhost:3000/admin`
- Master portal: `http://localhost:3000/master`

### Testing

There is no formal test framework (no jest/mocha). The project has ad-hoc test scripts in `scripts/` (e.g., `test-endpoints.js`, `test-s3.js`). Verify behavior via API calls or browser interaction.

### Gotchas

- `npm install` may skip devDependencies if `NODE_ENV=production`. Use `npm install --include=dev` to ensure `tailwindcss` and `nodemon` are available.
- The app crashes immediately if PostgreSQL is not running or `DATABASE_URL` is not set.
- S3/AWS features gracefully degrade when credentials are missing (local file upload fallback).
