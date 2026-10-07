# Files

- [AI Agents](ai-agents.md) - How NAKA-AI registers Mastra agents, assembles their instructions from prompt files, skills and language directives, resolves the text model per request, and adapts to relay providers with a chain of fetch patches.
- [Backend Server](backend-server.md) - The Hono server entrypoint — optional Basic auth, route mounting under /api/v1, static file serving, data-root resolution, uniform response/error helpers, and the startup sweeps that recover work interrupted by a restart.
- [Database](database.md) - SQLite persistence via better-sqlite3 and Drizzle — connection settings, idempotent DDL replay plus versioned column migrations, seeded style presets, consistent backups, and the one-time MySQL import.
- [Desktop App](desktop-app.md) - How the Electron shell boots the bundled backend as a utility process, manages userData and the workspace template, migrates the data directory, self-updates, and is packaged and released.
- [Frontend](frontend.md) - The Nuxt 3 single-page app — manual dynamic route registration, the useApi fetch client and its error-code contract, i18n, the desktop bridge, and where each product area's views live.
