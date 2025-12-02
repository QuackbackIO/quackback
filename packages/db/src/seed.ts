/**
 * Database seed script for development.
 * Creates demo data for testing the application.
 *
 * Usage: bun run db:seed
 */
import { config } from 'dotenv'
config({ path: '../../.env', quiet: true })

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { user, organization, member, account } from './schema/auth'
import { boards, tags, roadmaps } from './schema/boards'
import { posts, comments, votes } from './schema/posts'

const connectionString = process.env.DATABASE_URL!
const client = postgres(connectionString)
const db = drizzle(client)

// Use crypto for proper UUIDs
function uuid() {
  return crypto.randomUUID()
}

async function seed() {
  console.log('Seeding database...\n')

  // Check if demo user already exists
  const existingUser = await db.select().from(user).where(eq(user.email, 'demo@example.com'))
  if (existingUser.length > 0) {
    console.log('Demo data already exists. To re-seed, run:')
    console.log('  bun run db:reset && bun run db:push && bun run db:seed\n')
    await client.end()
    process.exit(0)
  }

  // Generate IDs
  const demoUserId = uuid()
  const demoOrgId = uuid()
  const demoBoardId = uuid()
  const demoRoadmapId = uuid()

  // Create demo user
  console.log('Creating demo user...')
  await db.insert(user).values({
    id: demoUserId,
    name: 'Demo User',
    email: 'demo@example.com',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  // Create demo account (email/password)
  await db.insert(account).values({
    id: uuid(),
    accountId: demoUserId,
    providerId: 'credential',
    userId: demoUserId,
    // Password: "demo1234" (hashed with bcrypt)
    password: '$2a$10$K7L1OJ45/4Y2nIvhRVpCe.FSmhDdWoXehVzJptJ/op0lLfy0aVc4.',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  // Create demo organization
  console.log('Creating demo organization...')
  await db.insert(organization).values({
    id: demoOrgId,
    name: 'Acme Corp',
    slug: 'acme',
    createdAt: new Date(),
  })

  // Add user as organization owner
  await db.insert(member).values({
    id: uuid(),
    organizationId: demoOrgId,
    userId: demoUserId,
    role: 'owner',
    createdAt: new Date(),
  })

  // Create tags
  console.log('Creating tags...')
  const tagBugId = uuid()
  const tagFeatureId = uuid()
  const tagUxId = uuid()
  const tagPerfId = uuid()

  await db.insert(tags).values([
    { id: tagBugId, organizationId: demoOrgId, name: 'Bug', color: '#ef4444' },
    { id: tagFeatureId, organizationId: demoOrgId, name: 'Feature', color: '#3b82f6' },
    { id: tagUxId, organizationId: demoOrgId, name: 'UX', color: '#8b5cf6' },
    { id: tagPerfId, organizationId: demoOrgId, name: 'Performance', color: '#f59e0b' },
  ])

  // Create feedback board
  console.log('Creating feedback board...')
  await db.insert(boards).values({
    id: demoBoardId,
    organizationId: demoOrgId,
    slug: 'feedback',
    name: 'Product Feedback',
    description: 'Share your ideas and vote on features',
    isPublic: true,
  })

  // Create roadmap
  console.log('Creating roadmap...')
  await db.insert(roadmaps).values({
    id: demoRoadmapId,
    boardId: demoBoardId,
    slug: 'product',
    name: 'Product Roadmap',
    description: 'Our planned features and improvements',
    isPublic: true,
  })

  // Create sample posts
  console.log('Creating sample posts...')
  const postIds = {
    darkMode: uuid(),
    mobileApp: uuid(),
    shortcuts: uuid(),
    csvExport: uuid(),
    slackBug: uuid(),
  }

  await db.insert(posts).values([
    {
      id: postIds.darkMode,
      boardId: demoBoardId,
      title: 'Dark mode support',
      content:
        'It would be great to have a dark mode option. Many of us work late and the bright interface can be straining on the eyes.',
      authorId: demoUserId,
      authorName: 'Demo User',
      authorEmail: 'demo@example.com',
      status: 'planned',
      voteCount: 42,
    },
    {
      id: postIds.mobileApp,
      boardId: demoBoardId,
      title: 'Mobile app for iOS and Android',
      content:
        'A native mobile app would make it much easier to manage feedback on the go. Push notifications for new comments would be essential.',
      authorId: demoUserId,
      authorName: 'Demo User',
      authorEmail: 'demo@example.com',
      status: 'under_review',
      voteCount: 38,
    },
    {
      id: postIds.shortcuts,
      boardId: demoBoardId,
      title: 'Keyboard shortcuts',
      content:
        'Adding keyboard shortcuts for common actions would speed up workflow significantly. J/K for navigation, V for vote, etc.',
      authorId: demoUserId,
      authorName: 'Demo User',
      authorEmail: 'demo@example.com',
      status: 'in_progress',
      voteCount: 25,
    },
    {
      id: postIds.csvExport,
      boardId: demoBoardId,
      title: 'Export feedback to CSV',
      content:
        'We need the ability to export all feedback data to CSV for reporting and analysis in spreadsheet tools.',
      authorId: demoUserId,
      authorName: 'Demo User',
      authorEmail: 'demo@example.com',
      status: 'complete',
      voteCount: 67,
    },
    {
      id: postIds.slackBug,
      boardId: demoBoardId,
      title: 'Slack integration not working',
      content:
        'When I try to connect Slack, I get an error message. This worked fine last week. Can you please investigate?',
      authorName: 'Anonymous User',
      status: 'open',
      voteCount: 5,
    },
  ])

  // Create sample comments
  console.log('Creating sample comments...')
  await db.insert(comments).values([
    {
      id: uuid(),
      postId: postIds.darkMode,
      authorId: demoUserId,
      authorName: 'Demo User',
      content: 'This is definitely on our radar. We are looking at implementing this in Q2.',
    },
    {
      id: uuid(),
      postId: postIds.darkMode,
      authorName: 'Sarah Chen',
      authorEmail: 'sarah@example.com',
      content: '+1 for dark mode! My eyes would thank you.',
    },
    {
      id: uuid(),
      postId: postIds.mobileApp,
      authorName: 'Mike Johnson',
      authorEmail: 'mike@example.com',
      content:
        'Would love push notifications for when my feedback gets a response. That would be super useful.',
    },
  ])

  // Create sample votes
  console.log('Creating sample votes...')
  await db.insert(votes).values([
    { id: uuid(), postId: postIds.darkMode, userIdentifier: demoUserId },
    { id: uuid(), postId: postIds.mobileApp, userIdentifier: demoUserId },
    { id: uuid(), postId: postIds.shortcuts, userIdentifier: demoUserId },
  ])

  console.log('\nSeed complete!\n')
  console.log('Demo credentials:')
  console.log('  Email:    demo@example.com')
  console.log('  Password: demo1234')
  console.log('')
  console.log('Demo organization:')
  console.log('  Name: Acme Corp')
  console.log('  URL:  http://acme.localhost:3000')
  console.log('')

  await client.end()
}

seed().catch(async (error) => {
  console.error('Seed failed:', error)
  await client.end()
  process.exitCode = 1
})
