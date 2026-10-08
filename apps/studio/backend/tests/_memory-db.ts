/**
 * Import FIRST in a test whose static imports reach src/core/db (ESM runs imports in order):
 * the database is then an in-process PGlite that disappears on exit, never data/pglite or a real server.
 */
process.env.DATABASE_URL = 'pglite://memory'
