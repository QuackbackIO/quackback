/**
 * Database seed script for development.
 * Creates realistic demo data (~500 posts) for testing.
 *
 * Usage: bun run db:seed
 */
import { config } from 'dotenv'
config({ path: '../../.env', quiet: true })

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { generateId, toMemberId } from '@quackback/ids'
import type { TagId, BoardId, StatusId, MemberId, PostId, RoadmapId } from '@quackback/ids'
import { user, organization, member, workspaceDomain } from './schema/auth'
import { boards, tags, roadmaps } from './schema/boards'
import { posts, postTags, postRoadmaps, votes, comments } from './schema/posts'
import { postStatuses, DEFAULT_STATUSES } from './schema/statuses'

const connectionString = process.env.DATABASE_URL!
const client = postgres(connectionString)
const db = drizzle(client)

// Configuration
const CONFIG = {
  users: 30,
  posts: 500,
}

// Demo credentials
const DEMO_USER = {
  email: 'demo@example.com',
  name: 'Demo User',
}

const DEMO_ORG = {
  name: 'Acme Corp',
  slug: 'acme',
}

function uuid() {
  return crypto.randomUUID()
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomDate(daysAgo: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - Math.floor(Math.random() * daysAgo))
  return date
}

function textToTipTapJson(text: string): object {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  }
}

// Sample data
const firstNames = [
  'Sarah',
  'Marcus',
  'Emily',
  'David',
  'Rachel',
  'Alex',
  'Jordan',
  'Taylor',
  'Casey',
  'Morgan',
  'Jamie',
  'Riley',
  'Quinn',
  'Avery',
  'Blake',
]
const lastNames = [
  'Chen',
  'Johnson',
  'Rodriguez',
  'Kim',
  'Thompson',
  'Martinez',
  'Lee',
  'Wilson',
  'Brown',
  'Davis',
  'Garcia',
  'Anderson',
  'Taylor',
  'Moore',
  'Jackson',
]

const boardPresets = [
  { name: 'Feature Requests', slug: 'features', description: 'Vote on new feature ideas' },
  { name: 'Bug Reports', slug: 'bugs', description: 'Report and track bugs' },
  { name: 'General Feedback', slug: 'feedback', description: 'Share your thoughts' },
  { name: 'Integrations', slug: 'integrations', description: 'Third-party integration requests' },
]

const tagPresets = [
  { name: 'Bug', color: '#ef4444' },
  { name: 'Feature', color: '#3b82f6' },
  { name: 'Enhancement', color: '#8b5cf6' },
  { name: 'UX', color: '#ec4899' },
  { name: 'Performance', color: '#f59e0b' },
  { name: 'API', color: '#84cc16' },
]

const roadmapPresets = [
  { name: 'Product Roadmap', slug: 'product-roadmap', description: 'Our main product roadmap' },
  { name: 'Q1 2025', slug: 'q1-2025', description: 'Features planned for Q1 2025' },
  { name: 'Mobile App', slug: 'mobile', description: 'Mobile app development roadmap' },
]

const postTitles = [
  'Dark mode support',
  'Slack integration',
  'Export to CSV',
  'Mobile app',
  'Keyboard shortcuts',
  'Search improvements',
  'API documentation',
  'Merge duplicate posts',
  'Custom branding',
  'Email notifications',
  'Two-factor authentication',
  'Bulk actions',
  'Custom fields',
  'Webhooks support',
  'SSO/SAML support',
  'Improved dashboard',
  'Real-time updates',
  'Comment mentions',
  'File attachments',
  'Analytics dashboard',
  'User roles',
  'Audit log',
  'Import from CSV',
  'Public API',
  'Mobile notifications',
  'Offline mode',
  'Custom domains',
  'White-label option',
  'Multi-language support',
  'Advanced filtering',
  'Saved views',
  'Zapier integration',
  'GitHub sync',
  'Jira integration',
  'Linear integration',
  'Roadmap timeline',
  'Gantt chart view',
  'Priority levels',
  'Due dates',
  'Recurring feedback',
]

const postContents = [
  'Would love to see this feature added. Our team would really benefit from it.',
  'This is a must-have for our workflow. Currently using a workaround but native support would be better.',
  'Please prioritize this! Many users have been asking for it.',
  'This would save us hours every week. Really hoping to see this implemented soon.',
  'Our customers keep asking about this. Would be great to have it built-in.',
  '+1 from our team. This is essential for enterprise users.',
  'Coming from a competitor, this was one feature we really miss.',
  'This has been requested multiple times. Any update on the timeline?',
  'Would happily pay extra for this feature. It is critical for our use case.',
  'The current workaround is tedious. A native solution would be much appreciated.',
]

const commentContents = [
  '+1, we need this too!',
  'Any update on this?',
  'This would be huge for our team.',
  'Agreed, please prioritize this.',
  'We have a workaround but native support would be better.',
  'Is this on the roadmap?',
  'Following this thread.',
  'Same here, this is blocking us.',
  'Would love to see this shipped soon!',
  'Thanks for considering this!',
]

const statusSlugs = ['open', 'under_review', 'planned', 'in_progress', 'complete', 'closed']
const statusWeights = [30, 20, 20, 15, 10, 5] // Weighted distribution

function weightedStatus(): string {
  const total = statusWeights.reduce((a, b) => a + b, 0)
  let random = Math.random() * total
  for (let i = 0; i < statusSlugs.length; i++) {
    random -= statusWeights[i]
    if (random <= 0) return statusSlugs[i]
  }
  return 'open'
}

function generateVoteCount(): number {
  const roll = Math.random()
  if (roll < 0.5) return Math.floor(Math.random() * 10) // 0-9
  if (roll < 0.8) return 10 + Math.floor(Math.random() * 40) // 10-49
  if (roll < 0.95) return 50 + Math.floor(Math.random() * 100) // 50-149
  return 150 + Math.floor(Math.random() * 200) // 150-349
}

async function verifyMigrationsApplied() {
  const roleCheck = await client`SELECT 1 FROM pg_roles WHERE rolname = 'app_user'`
  if (roleCheck.length === 0) {
    throw new Error('Database migrations have not been applied. Run: bun run db:migrate')
  }
}

async function seed() {
  console.log('Seeding database...\n')

  await verifyMigrationsApplied()

  // Create organization
  const orgId = uuid()
  await db.insert(organization).values({
    id: orgId,
    name: DEMO_ORG.name,
    slug: DEMO_ORG.slug,
    createdAt: new Date(),
  })

  await db.insert(workspaceDomain).values({
    id: uuid(),
    organizationId: orgId,
    domain: `${DEMO_ORG.slug}.localhost:3000`,
    domainType: 'subdomain',
    isPrimary: true,
    verified: true,
  })
  console.log('Created organization: Acme Corp')

  // Create statuses
  const statusMap = new Map<string, StatusId>()
  for (const status of DEFAULT_STATUSES) {
    const result = await db
      .insert(postStatuses)
      .values({
        organizationId: orgId,
        ...status,
      })
      .returning()
    statusMap.set(status.slug, result[0].id)
  }
  console.log('Created default statuses')

  // Create demo user (owner)
  const demoUserId = uuid()
  const demoMemberId = uuid()
  await db.insert(user).values({
    id: demoUserId,
    organizationId: orgId,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(member).values({
    id: demoMemberId,
    organizationId: orgId,
    userId: demoUserId,
    role: 'owner',
    createdAt: new Date(),
  })

  // Create sample users
  const members: Array<{ id: MemberId; name: string }> = [
    { id: toMemberId(demoMemberId), name: DEMO_USER.name },
  ]
  for (let i = 0; i < CONFIG.users; i++) {
    const userId = uuid()
    const memberId = uuid()
    const name = `${pick(firstNames)} ${pick(lastNames)}`
    const email = `user${i + 1}@example.com`

    await db.insert(user).values({
      id: userId,
      organizationId: orgId,
      name,
      email,
      emailVerified: true,
      createdAt: randomDate(90),
      updatedAt: new Date(),
    })
    await db.insert(member).values({
      id: memberId,
      organizationId: orgId,
      userId: userId,
      role: i < 3 ? 'admin' : 'user', // First 3 are admins
      createdAt: randomDate(90),
    })
    members.push({ id: toMemberId(memberId), name })
  }
  console.log(`Created ${members.length} users`)

  // Create tags
  const tagIds: TagId[] = []
  for (const t of tagPresets) {
    const tagId = generateId('tag')
    await db.insert(tags).values({
      id: tagId,
      organizationId: orgId,
      name: t.name,
      color: t.color,
    })
    tagIds.push(tagId)
  }
  console.log(`Created ${tagPresets.length} tags`)

  // Create boards
  const boardIds: BoardId[] = []
  for (const b of boardPresets) {
    const boardId = generateId('board')
    await db.insert(boards).values({
      id: boardId,
      organizationId: orgId,
      slug: b.slug,
      name: b.name,
      description: b.description,
      isPublic: true,
      createdAt: randomDate(60),
    })
    boardIds.push(boardId)
  }
  console.log(`Created ${boardPresets.length} boards`)

  // Create roadmaps
  const roadmapIds: RoadmapId[] = []
  for (let i = 0; i < roadmapPresets.length; i++) {
    const r = roadmapPresets[i]
    const roadmapId = generateId('roadmap')
    await db.insert(roadmaps).values({
      id: roadmapId,
      organizationId: orgId,
      slug: r.slug,
      name: r.name,
      description: r.description,
      isPublic: true,
      position: i,
      createdAt: randomDate(30),
    })
    roadmapIds.push(roadmapId)
  }
  console.log(`Created ${roadmapPresets.length} roadmaps`)

  // Create posts in batches
  console.log(`Creating ${CONFIG.posts} posts...`)
  const postRecords: Array<{ id: PostId; voteCount: number; statusSlug: string }> = []

  const postInserts: (typeof posts.$inferInsert)[] = []
  const postTagInserts: (typeof postTags.$inferInsert)[] = []

  for (let i = 0; i < CONFIG.posts; i++) {
    const postId = generateId('post')
    const boardId = pick(boardIds)
    const author = pick(members)
    const statusSlug = weightedStatus()
    const statusId = statusMap.get(statusSlug) ?? null
    const voteCount = generateVoteCount()
    const title =
      postTitles[i % postTitles.length] +
      (i >= postTitles.length ? ` (${Math.floor(i / postTitles.length) + 1})` : '')
    const content = pick(postContents)

    postInserts.push({
      id: postId,
      organizationId: orgId,
      boardId,
      title,
      content,
      contentJson: textToTipTapJson(content),
      memberId: author.id,
      authorName: author.name,
      statusId,
      voteCount,
      createdAt: randomDate(180),
      updatedAt: new Date(),
    })

    postRecords.push({ id: postId, voteCount, statusSlug })

    // Add 1-2 tags
    const numTags = 1 + Math.floor(Math.random() * 2)
    const usedTags = new Set<TagId>()
    for (let t = 0; t < numTags; t++) {
      const tagId = pick(tagIds)
      if (!usedTags.has(tagId)) {
        usedTags.add(tagId)
        postTagInserts.push({ postId, tagId })
      }
    }
  }

  // Batch insert posts
  const BATCH_SIZE = 100
  for (let i = 0; i < postInserts.length; i += BATCH_SIZE) {
    await db.insert(posts).values(postInserts.slice(i, i + BATCH_SIZE))
  }
  for (let i = 0; i < postTagInserts.length; i += BATCH_SIZE) {
    await db
      .insert(postTags)
      .values(postTagInserts.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing()
  }
  console.log(`Created ${CONFIG.posts} posts`)

  // Assign posts to roadmaps (posts with planned/in_progress/complete status)
  const roadmapStatusSlugs = ['planned', 'in_progress', 'complete']
  const postRoadmapInserts: (typeof postRoadmaps.$inferInsert)[] = []
  const roadmapPositions = new Map<RoadmapId, number>()
  roadmapIds.forEach((id) => roadmapPositions.set(id, 0))

  for (const post of postRecords) {
    if (roadmapStatusSlugs.includes(post.statusSlug)) {
      // Assign to 1-2 random roadmaps
      const numRoadmaps = 1 + Math.floor(Math.random() * 2)
      const usedRoadmaps = new Set<RoadmapId>()
      for (let r = 0; r < numRoadmaps; r++) {
        const roadmapId = pick(roadmapIds)
        if (!usedRoadmaps.has(roadmapId)) {
          usedRoadmaps.add(roadmapId)
          const position = roadmapPositions.get(roadmapId) ?? 0
          postRoadmapInserts.push({
            postId: post.id,
            roadmapId,
            position,
          })
          roadmapPositions.set(roadmapId, position + 1)
        }
      }
    }
  }
  for (let i = 0; i < postRoadmapInserts.length; i += BATCH_SIZE) {
    await db.insert(postRoadmaps).values(postRoadmapInserts.slice(i, i + BATCH_SIZE))
  }
  console.log(`Assigned ${postRoadmapInserts.length} posts to roadmaps`)

  // Create votes (sample, not all)
  console.log('Creating votes...')
  const voteInserts: (typeof votes.$inferInsert)[] = []
  for (const post of postRecords) {
    const numVotes = Math.min(post.voteCount, 10) // Cap at 10 actual vote records per post
    for (let v = 0; v < numVotes; v++) {
      voteInserts.push({
        organizationId: orgId,
        postId: post.id,
        userIdentifier: `user:${uuid()}`,
        createdAt: randomDate(60),
      })
    }
  }
  for (let i = 0; i < voteInserts.length; i += BATCH_SIZE) {
    await db.insert(votes).values(voteInserts.slice(i, i + BATCH_SIZE))
  }
  console.log(`Created ${voteInserts.length} votes`)

  // Create comments
  console.log('Creating comments...')
  const commentInserts: (typeof comments.$inferInsert)[] = []
  for (const post of postRecords) {
    const numComments = Math.floor(Math.random() * 5) // 0-4 comments per post
    for (let c = 0; c < numComments; c++) {
      const author = pick(members)
      commentInserts.push({
        organizationId: orgId,
        postId: post.id,
        memberId: author.id,
        authorName: author.name,
        content: pick(commentContents),
        isTeamMember: Math.random() < 0.2,
        createdAt: randomDate(60),
      })
    }
  }
  for (let i = 0; i < commentInserts.length; i += BATCH_SIZE) {
    await db.insert(comments).values(commentInserts.slice(i, i + BATCH_SIZE))
  }
  console.log(`Created ${commentInserts.length} comments`)

  console.log('\n✅ Seed complete!\n')
  console.log('Demo account:')
  console.log(`  Email: ${DEMO_USER.email}`)
  console.log('  Sign in with OTP code\n')
  console.log(`Portal: http://${DEMO_ORG.slug}.localhost:3000`)

  await client.end()
}

seed().catch(async (error) => {
  console.error('Seed failed:', error)
  await client.end()
  process.exitCode = 1
})
