# hack-5abba766-orbit-jr
Hackathon team repository for orbit.jr

## Career Quest frontend

Interactive Next.js / React / TypeScript UI prototype. Requires Node.js 22 LTS.

```bash
npm ci
npm run dev
```

Open http://localhost:3000/employee or http://localhost:3000/hr.

```bash
npm run build
npm run typecheck
```

Includes responsive employee overview, career goals, skills, searchable catalog,
activity history, simulated completions, HR preview and local JSON preflight.
Uses explicitly labeled demo fixtures; backend authentication, AI and real import
are not connected yet. No API keys or original dataset are included.

See [frontend integration notes](docs/FRONTEND.md) and
[project architecture](docs/ARCHITECTURE.md).
