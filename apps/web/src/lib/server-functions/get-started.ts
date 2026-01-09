/**
 * Get Started Server Functions
 *
 * Handles the complete workspace creation flow:
 * 1. Email verification (6-digit code)
 * 2. Code verification (returns token)
 * 3. Slug availability check
 * 4. Workspace creation (Neon project, migrations, seeding)
 *
 * All catalog DB schema and helpers are inline to minimize abstraction layers.
 *
 * After provisioning, uses better-auth's oneTimeToken plugin for session transfer.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, and, gt } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, integer, index, unique } from 'drizzle-orm/pg-core'
import { neon } from '@neondatabase/serverless'
import { createApiClient } from '@neondatabase/api-client'
import postgres from 'postgres'
import crypto from 'node:crypto'
import path from 'path'
import { typeid } from 'typeid-js'
import { sendSigninCodeEmail } from '@quackback/email'

// ============================================
// Catalog Schema (inline - matches website)
// ============================================

const workspace = pgTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  neonProjectId: text('neon_project_id'),
  neonRegion: text('neon_region').default('aws-us-east-1'),
  migrationStatus: text('migration_status').default('pending'), // 'pending' | 'in_progress' | 'completed'
})

const workspaceDomain = pgTable(
  'workspace_domain',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull().unique(),
    domainType: text('domain_type').notNull(), // 'subdomain' | 'custom'
    isPrimary: boolean('is_primary').default(false).notNull(),
    verified: boolean('verified').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('workspace_domain_workspace_id_idx').on(table.workspaceId)]
)

const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
  },
  (table) => [
    index('verification_identifier_idx').on(table.identifier),
    unique('verification_identifier_unique').on(table.identifier),
  ]
)

const catalogSchema = { workspace, workspaceDomain, verification }

// ============================================
// Inline Helpers
// ============================================

/** Generate a TypeID and return its UUID representation */
function generateUuid(prefix: string): string {
  return typeid(prefix).toUUID()
}

/** Get catalog database connection */
function getCatalogDb() {
  const url = process.env.CLOUD_CATALOG_DATABASE_URL
  if (!url) {
    throw new Error('CLOUD_CATALOG_DATABASE_URL is required for cloud mode')
  }
  const sql = postgres(url, { max: 5 })
  return drizzle(sql, { schema: catalogSchema })
}

/** Wait for Neon database to accept connections */
async function waitForNeonReady(connectionString: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const sql = neon(connectionString)
      await sql`SELECT 1`
      return
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw new Error('Database not ready after timeout')
}

/** Create Neon project with retry logic */
async function createNeonProject(
  name: string,
  region?: string
): Promise<{ projectId: string; connectionUri: string }> {
  const apiKey = process.env.CLOUD_NEON_API_KEY
  if (!apiKey) {
    throw new Error('CLOUD_NEON_API_KEY is required')
  }

  const client = createApiClient({ apiKey })
  const defaultRegion = process.env.CLOUD_NEON_DEFAULT_REGION || 'aws-us-east-1'

  // Retry logic for transient errors
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await client.createProject({
        project: {
          name,
          region_id: region || defaultRegion,
        },
      })

      const connectionUri = response.data.connection_uris?.[0]?.connection_uri
      if (!connectionUri) {
        throw new Error('No connection URI returned from Neon')
      }

      return {
        projectId: response.data.project.id,
        connectionUri,
      }
    } catch (error) {
      lastError = error as Error
      // Retry on 429 or 5xx
      if (attempt < 2) {
        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 10000)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }

  throw lastError || new Error('Failed to create Neon project')
}

/** Delete Neon project (for cleanup on failure) */
async function deleteNeonProject(projectId: string): Promise<void> {
  const apiKey = process.env.CLOUD_NEON_API_KEY
  if (!apiKey) return

  try {
    const client = createApiClient({ apiKey })
    await client.deleteProject(projectId)
  } catch {
    // Ignore cleanup errors
  }
}

/** Run migrations on tenant database using raw SQL */
async function runTenantMigrations(connectionString: string): Promise<void> {
  const sql = neon(connectionString)

  // Read the initial migration SQL
  // In production, this would be bundled or read from a known location
  const fs = await import('fs/promises')
  const migrationPath = path.join(
    process.cwd(),
    'node_modules/@quackback/db/drizzle/0000_initial.sql'
  )
  const migrationSql = await fs.readFile(migrationPath, 'utf-8')

  // Split by statement breakpoint and execute each statement
  const statements = migrationSql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'))

  for (const statement of statements) {
    if (statement.trim()) {
      await sql`${sql.unsafe(statement)}`
    }
  }
}

/** Seed initial tenant data and return the created user ID */
async function seedTenantData(
  connectionString: string,
  input: {
    workspaceId: string
    name: string
    slug: string
    ownerEmail: string
    ownerName: string
  }
): Promise<{ userId: string }> {
  const sql = neon(connectionString)

  const userId = generateUuid('user')
  const memberId = generateUuid('member')
  const boardId = generateUuid('board')

  await sql.transaction([
    // Create settings
    sql`
      INSERT INTO "settings" ("id", "name", "slug", "created_at", "portal_config", "auth_config", "branding_config")
      VALUES (
        ${input.workspaceId}::uuid,
        ${input.name},
        ${input.slug},
        NOW(),
        '{"features":{"publicView":true,"submissions":true,"comments":true,"voting":true}}'::text,
        '{"oauth":{"google":true,"github":true,"microsoft":false},"openSignup":true}'::text,
        '{}'::text
      )
    `,

    // Create owner user
    sql`
      INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
      VALUES (
        ${userId}::uuid,
        ${input.ownerName},
        ${input.ownerEmail.toLowerCase()},
        true,
        NOW(),
        NOW()
      )
    `,

    // Create owner member
    sql`
      INSERT INTO "member" ("id", "user_id", "role", "created_at")
      VALUES (${memberId}::uuid, ${userId}::uuid, 'owner', NOW())
    `,

    // Create default board
    sql`
      INSERT INTO "boards" ("id", "name", "slug", "description", "is_public", "created_at", "updated_at")
      VALUES (
        ${boardId}::uuid,
        'Feature Requests',
        'feature-requests',
        'Share and vote on feature ideas',
        true,
        NOW(),
        NOW()
      )
    `,
  ])

  return { userId }
}

/** Generate a one-time token directly in the tenant database */
async function generateOneTimeToken(connectionString: string, userId: string): Promise<string> {
  const sql = neon(connectionString)
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 60 * 1000) // 1 minute expiry

  await sql`
    INSERT INTO "one_time_token" ("id", "token", "user_id", "expires_at")
    VALUES (${crypto.randomUUID()}, ${token}, ${userId}::uuid, ${expiresAt.toISOString()}::timestamp)
  `

  return token
}

// ============================================
// Server Functions
// ============================================

const RESERVED_SLUGS = [
  'app',
  'api',
  'admin',
  'www',
  'dashboard',
  'help',
  'support',
  'blog',
  'docs',
  'status',
  'mail',
  'email',
  'ftp',
  'cdn',
  'static',
  'assets',
]

/**
 * Send verification code to email
 */
export const sendVerificationCode = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    const db = getCatalogDb()
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const identifier = `workspace-creation:${data.email.toLowerCase()}`
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Upsert verification code
    await db
      .insert(verification)
      .values({
        id: generateUuid('verification'),
        identifier,
        value: code,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: verification.identifier,
        set: { value: code, expiresAt },
      })

    // Send email (uses Resend in production, logs in dev)
    await sendSigninCodeEmail({ to: data.email, code })

    return { success: true }
  })

/**
 * Verify the 6-digit code and return a verification token
 */
export const verifyCode = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ email: z.string().email(), code: z.string().length(6) }))
  .handler(async ({ data }) => {
    const db = getCatalogDb()
    const identifier = `workspace-creation:${data.email.toLowerCase()}`

    // Find valid verification record
    const record = await db.query.verification.findFirst({
      where: and(
        eq(verification.identifier, identifier),
        eq(verification.value, data.code),
        gt(verification.expiresAt, new Date())
      ),
    })

    if (!record) {
      throw new Error('Invalid or expired verification code')
    }

    // Create verification token (valid for 30 minutes)
    const token = crypto.randomUUID()
    const verifiedIdentifier = `verified:${data.email.toLowerCase()}`

    await db
      .insert(verification)
      .values({
        id: generateUuid('verification'),
        identifier: verifiedIdentifier,
        value: token,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      })
      .onConflictDoUpdate({
        target: verification.identifier,
        set: { value: token, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
      })

    // Delete the used code
    await db.delete(verification).where(eq(verification.id, record.id))

    return { token }
  })

/**
 * Check if a slug is available
 */
export const checkSlugAvailability = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ slug: z.string().min(3).max(32) }))
  .handler(async ({ data }) => {
    const slug = data.slug.toLowerCase()

    // Validate format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return {
        available: false,
        reason: 'Slug must only contain lowercase letters, numbers, and hyphens',
      }
    }

    if (slug.startsWith('-') || slug.endsWith('-')) {
      return { available: false, reason: 'Slug cannot start or end with a hyphen' }
    }

    // Check reserved
    if (RESERVED_SLUGS.includes(slug)) {
      return { available: false, reason: 'This slug is reserved' }
    }

    // Check database
    const db = getCatalogDb()
    const existing = await db.query.workspace.findFirst({
      where: eq(workspace.slug, slug),
    })

    return { available: !existing }
  })

/**
 * Create workspace - main orchestration function
 */
export const createWorkspaceFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      email: z.string().email(),
      name: z.string().min(1).max(100),
      slug: z.string().min(3).max(32),
      verificationToken: z.string().uuid(),
    })
  )
  .handler(async ({ data }) => {
    const db = getCatalogDb()
    const email = data.email.toLowerCase()
    const slug = data.slug.toLowerCase()

    // 1. Validate verification token
    const tokenRecord = await db.query.verification.findFirst({
      where: and(
        eq(verification.identifier, `verified:${email}`),
        eq(verification.value, data.verificationToken),
        gt(verification.expiresAt, new Date())
      ),
    })

    if (!tokenRecord) {
      throw new Error('Invalid or expired verification token')
    }

    // 2. Check slug availability one more time
    const existingWorkspace = await db.query.workspace.findFirst({
      where: eq(workspace.slug, slug),
    })

    if (existingWorkspace) {
      throw new Error('This workspace URL is no longer available')
    }

    const workspaceId = generateUuid('workspace')
    let neonProjectId: string | null = null

    try {
      // 3. Create workspace record (in_progress)
      await db.insert(workspace).values({
        id: workspaceId,
        name: data.name,
        slug,
        migrationStatus: 'in_progress',
      })

      // 4. Create Neon project
      console.log(`[get-started] Creating Neon project for ${slug}...`)
      const neonProject = await createNeonProject(slug)
      neonProjectId = neonProject.projectId

      // 5. Update workspace with Neon project ID
      await db
        .update(workspace)
        .set({
          neonProjectId: neonProject.projectId,
        })
        .where(eq(workspace.id, workspaceId))

      // 6. Create subdomain record
      const baseDomain = process.env.CLOUD_TENANT_BASE_DOMAIN || 'quackback.io'
      await db.insert(workspaceDomain).values({
        id: generateUuid('domain'),
        workspaceId,
        domain: `${slug}.${baseDomain}`,
        domainType: 'subdomain',
        isPrimary: true,
      })

      // 7. Wait for database to be ready
      console.log(`[get-started] Waiting for Neon database to be ready...`)
      await waitForNeonReady(neonProject.connectionUri)

      // 8. Run migrations
      console.log(`[get-started] Running migrations...`)
      await runTenantMigrations(neonProject.connectionUri)

      // 9. Seed initial data
      console.log(`[get-started] Seeding tenant data...`)
      const { userId } = await seedTenantData(neonProject.connectionUri, {
        workspaceId,
        name: data.name,
        slug,
        ownerEmail: email,
        ownerName: data.name, // Use workspace name as owner name initially
      })

      // 10. Generate one-time token directly in tenant database
      console.log(`[get-started] Generating one-time token for ${email}...`)
      const oneTimeToken = await generateOneTimeToken(neonProject.connectionUri, userId)

      // 11. Mark migration complete
      await db
        .update(workspace)
        .set({ migrationStatus: 'completed' })
        .where(eq(workspace.id, workspaceId))

      // 12. Consume verification token
      await db.delete(verification).where(eq(verification.id, tokenRecord.id))

      const tenantDomain = `https://${slug}.${baseDomain}`

      console.log(`[get-started] Workspace ${slug} created successfully!`)

      return {
        success: true,
        workspaceId,
        slug,
        redirectUrl: `${tenantDomain}/api/auth/one-time-token/verify?token=${oneTimeToken}&callbackURL=/admin`,
      }
    } catch (error) {
      // Cleanup on failure
      console.error(`[get-started] Failed to create workspace:`, error)

      // Delete Neon project if created
      if (neonProjectId) {
        await deleteNeonProject(neonProjectId)
      }

      // Delete workspace record
      await db.delete(workspace).where(eq(workspace.id, workspaceId))

      throw error
    }
  })
