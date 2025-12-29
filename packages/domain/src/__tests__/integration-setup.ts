/**
 * Integration test setup for domain services
 *
 * Provides real database setup/teardown for integration testing.
 * Tests use actual PostgreSQL database instead of mocks.
 */

import { beforeAll, afterAll, beforeEach } from 'vitest'
import { db, sql } from '@quackback/db'

/**
 * Set up test database before all tests.
 * Requires DATABASE_URL environment variable pointing to test database.
 */
beforeAll(async () => {
  // Verify we're using a test database
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl?.includes('test')) {
    throw new Error(
      'DATABASE_URL must point to a test database (should contain "test" in the name)'
    )
  }

  // Migrations are run automatically on server start via better-auth
  // but we could also run them explicitly here if needed
})

/**
 * Clean database before each test to ensure isolation.
 * Truncates all tables to start fresh.
 */
beforeEach(async () => {
  // Truncate all tables with CASCADE to handle foreign keys
  await db.execute(sql`
    TRUNCATE TABLE
      "posts",
      "comments",
      "comment_reactions",
      "comment_edit_history",
      "votes",
      "post_subscriptions",
      "post_edit_history",
      "post_tags",
      "post_roadmaps",
      "boards",
      "tags",
      "post_statuses",
      "roadmaps",
      "member",
      "user",
      "session",
      "account",
      "verification",
      "unsubscribe_tokens",
      "notification_preferences",
      "integrations",
      "settings"
    CASCADE
  `)
})

/**
 * Clean up database connection after all tests.
 */
afterAll(async () => {
  // Close database connection pool
  // Note: Drizzle doesn't expose a close method directly,
  // but the connection will be cleaned up on process exit
})
