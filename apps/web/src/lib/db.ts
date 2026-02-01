/**
 * Database connection for the web app.
 *
 * IMPORTANT: Always import database utilities from '@/lib/db', not '@quackback/db'.
 * This ensures the database connection is properly initialized.
 *
 * This file re-exports everything from '@/lib/core/db' for backwards compatibility.
 * The actual implementation lives in lib/core/db.ts.
 *
 * @example
 * import { db, eq, and, posts } from '@/lib/db'
 */

export * from './core/db'
