/**
 * Database seed script for development.
 * Creates realistic demo data (~500 posts) for testing.
 *
 * Usage: bun run db:seed
 */
import { config } from 'dotenv'
config({ path: '../../.env', quiet: true })

import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { generateId } from '@quackback/ids'
import type {
  TagId,
  BoardId,
  StatusId,
  PrincipalId,
  PostId,
  RoadmapId,
  UserId,
  WorkspaceId,
  ChangelogId,
} from '@quackback/ids'
import { user, account, settings, principal } from './schema/auth'
import { boards, tags, roadmaps } from './schema/boards'
import { posts, postTags, postRoadmaps, votes, comments } from './schema/posts'
import { postStatuses, DEFAULT_STATUSES } from './schema/statuses'
import { changelogEntries, changelogEntryPosts } from './schema/changelog'

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
  password: 'password',
}

// Pre-computed scrypt hash of "password" (compatible with better-auth's hashPassword)
// Format: {salt_hex}:{key_hex} using scrypt N=16384, r=16, p=1, dkLen=64
const DEMO_PASSWORD_HASH =
  '2180e82a0687f69e51799d64752d0093:b6aef896c3437e07e4fa8389a068b2f6baac8f413b987045cbd030e267b0ddba9362541876e4df03108b3c339e7d813c0bce49c8973da0d3d268cb8ec2c16d50'

const DEMO_ORG = {
  name: 'Acme Corp',
  slug: 'acme',
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomDate(daysAgo: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - Math.floor(Math.random() * daysAgo))
  return date
}

function textToTipTapJson(text: string) {
  return {
    type: 'doc' as const,
    content: text.split('\n').map((line) => ({
      type: 'paragraph' as const,
      content: line ? [{ type: 'text' as const, text: line }] : [],
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

const changelogPresets = [
  {
    title: 'Introducing Dark Mode',
    content:
      'We heard your feedback loud and clear! Dark mode is finally here. Toggle it from Settings > Appearance or let your system preference decide. This update also includes improved contrast ratios for better accessibility.',
    status: 'published' as const,
    daysAgo: 3,
  },
  {
    title: 'Slack Integration Now Available',
    content:
      'Connect your workspace to Slack and get real-time notifications for new feedback, votes, and status changes. Set up custom channels for different boards and never miss important updates from your users.',
    status: 'published' as const,
    daysAgo: 14,
  },
  {
    title: 'Export Your Data to CSV',
    content:
      'You can now export your posts, votes, and comments to CSV format. Perfect for reporting, analysis, or backing up your data. Find the export option in Settings > Data.',
    status: 'published' as const,
    daysAgo: 30,
  },
  {
    title: 'Coming Soon: Mobile App',
    content:
      'We are excited to announce that our mobile app is in development! Stay tuned for iOS and Android apps that let you manage feedback on the go. Beta testing will begin next month.',
    status: 'scheduled' as const,
    daysAhead: 7,
  },
  {
    title: 'Improved Search & Filtering',
    content:
      'Finding feedback just got easier. Our new search now supports fuzzy matching, filters by status/board/tag, and remembers your recent searches. Plus, saved views are coming soon!',
    status: 'draft' as const,
  },
  {
    title: 'Q1 2025 Roadmap Update',
    content:
      'Here is what we shipped this quarter and what is coming next. Thank you to everyone who submitted feedback - your input directly shapes our product direction.',
    status: 'published' as const,
    daysAgo: 45,
  },
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

async function seed() {
  console.log('Seeding database...\n')

  // Create settings (the singleton settings record) - skip if exists
  const existingSettings = await db.select().from(settings).limit(1)
  if (existingSettings.length === 0) {
    const settingsId: WorkspaceId = generateId('workspace')
    // Mark onboarding as complete so dev environment skips the onboarding flow
    const setupState = {
      version: 1,
      steps: {
        core: true,
        workspace: true,
        boards: true,
      },
      completedAt: new Date().toISOString(),
      source: 'self-hosted' as const,
    }
    await db.insert(settings).values({
      id: settingsId,
      name: DEMO_ORG.name,
      slug: DEMO_ORG.slug,
      createdAt: new Date(),
      setupState: JSON.stringify(setupState),
    })
    console.log('Created settings: Acme Corp (onboarding complete)')
  } else {
    console.log('Settings already exist, skipping')
  }

  // Create statuses - use existing or create new
  const statusMap = new Map<string, StatusId>()
  const existingStatuses = await db.select().from(postStatuses)
  if (existingStatuses.length > 0) {
    for (const status of existingStatuses) {
      statusMap.set(status.slug, status.id)
    }
    console.log('Using existing statuses')
  } else {
    for (const status of DEFAULT_STATUSES) {
      const result = await db.insert(postStatuses).values(status).returning()
      statusMap.set(status.slug, result[0].id)
    }
    console.log('Created default statuses')
  }

  // Get or create users and principals
  const existingPrincipals = await db
    .select({ id: principal.id, name: user.name })
    .from(principal)
    .innerJoin(user, eq(principal.userId, user.id))

  const principals: Array<{ id: PrincipalId; name: string }> = existingPrincipals.map((m) => ({
    id: m.id as PrincipalId,
    name: m.name,
  }))

  if (principals.length === 0) {
    // Create demo user (owner)
    const demoUserId: UserId = generateId('user')
    const demoPrincipalId: PrincipalId = generateId('principal')
    await db.insert(user).values({
      id: demoUserId,
      name: DEMO_USER.name,
      email: DEMO_USER.email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(principal).values({
      id: demoPrincipalId,
      userId: demoUserId,
      role: 'admin',
      displayName: DEMO_USER.name,
      createdAt: new Date(),
    })
    // Create credential account for password login
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: demoUserId,
      providerId: 'credential',
      userId: demoUserId,
      password: DEMO_PASSWORD_HASH,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    principals.push({ id: demoPrincipalId, name: DEMO_USER.name })

    // Create sample users
    for (let i = 0; i < CONFIG.users; i++) {
      const userId: UserId = generateId('user')
      const principalId: PrincipalId = generateId('principal')
      const name = `${pick(firstNames)} ${pick(lastNames)}`
      const email = `user${i + 1}@example.com`

      await db.insert(user).values({
        id: userId,
        name,
        email,
        emailVerified: true,
        createdAt: randomDate(90),
        updatedAt: new Date(),
      })
      await db.insert(principal).values({
        id: principalId,
        userId: userId,
        role: i < 3 ? 'admin' : 'user', // First 3 are admins
        displayName: name,
        createdAt: randomDate(90),
      })
      principals.push({ id: principalId, name })
    }
    console.log(`Created ${principals.length} users`)
  } else {
    console.log(`Using ${principals.length} existing users`)
  }

  // Create or get tags
  const tagIds: TagId[] = []
  const existingTags = await db.select().from(tags)
  if (existingTags.length > 0) {
    tagIds.push(...existingTags.map((t) => t.id))
    console.log(`Using ${existingTags.length} existing tags`)
  } else {
    for (const t of tagPresets) {
      const tagId = generateId('tag')
      await db.insert(tags).values({
        id: tagId,
        name: t.name,
        color: t.color,
      })
      tagIds.push(tagId)
    }
    console.log(`Created ${tagPresets.length} tags`)
  }

  // Create or get boards
  const boardIds: BoardId[] = []
  const existingBoards = await db.select().from(boards)
  if (existingBoards.length > 0) {
    boardIds.push(...existingBoards.map((b) => b.id))
    console.log(`Using ${existingBoards.length} existing boards`)
  } else {
    for (const b of boardPresets) {
      const boardId = generateId('board')
      await db.insert(boards).values({
        id: boardId,
        slug: b.slug,
        name: b.name,
        description: b.description,
        isPublic: true,
        createdAt: randomDate(60),
      })
      boardIds.push(boardId)
    }
    console.log(`Created ${boardPresets.length} boards`)
  }

  // Create or get roadmaps
  const roadmapIds: RoadmapId[] = []
  const existingRoadmaps = await db.select().from(roadmaps)
  if (existingRoadmaps.length > 0) {
    roadmapIds.push(...existingRoadmaps.map((r) => r.id))
    console.log(`Using ${existingRoadmaps.length} existing roadmaps`)
  } else {
    for (let i = 0; i < roadmapPresets.length; i++) {
      const r = roadmapPresets[i]
      const roadmapId = generateId('roadmap')
      await db.insert(roadmaps).values({
        id: roadmapId,
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
  }

  // Check if posts already exist
  const existingPostCount = await db.select({ id: posts.id }).from(posts).limit(1)
  if (existingPostCount.length > 0) {
    console.log('Posts already exist, skipping seed')
    console.log('\n✅ Seed complete (used existing data)!\n')
    await client.end()
    return
  }

  // Create posts in batches
  console.log(`Creating ${CONFIG.posts} posts...`)
  const postRecords: Array<{ id: PostId; voteCount: number; statusSlug: string }> = []

  const postInserts: (typeof posts.$inferInsert)[] = []
  const postTagInserts: (typeof postTags.$inferInsert)[] = []

  for (let i = 0; i < CONFIG.posts; i++) {
    const postId = generateId('post')
    const boardId = pick(boardIds)
    const author = pick(principals)
    const statusSlug = weightedStatus()
    const statusId = statusMap.get(statusSlug) ?? null
    const voteCount = generateVoteCount()
    const title =
      postTitles[i % postTitles.length] +
      (i >= postTitles.length ? ` (${Math.floor(i / postTitles.length) + 1})` : '')
    const content = pick(postContents)

    postInserts.push({
      id: postId,
      boardId,
      title,
      content,
      contentJson: textToTipTapJson(content),
      principalId: author.id,
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

  // Create votes (sample, not all) - votes require principalId
  console.log('Creating votes...')
  const voteInserts: (typeof votes.$inferInsert)[] = []
  for (const post of postRecords) {
    const numVotes = Math.min(post.voteCount, principals.length) // Cap at number of principals
    const shuffledPrincipals = [...principals].sort(() => Math.random() - 0.5)
    for (let v = 0; v < numVotes; v++) {
      voteInserts.push({
        postId: post.id,
        principalId: shuffledPrincipals[v % shuffledPrincipals.length].id,
        createdAt: randomDate(60),
      })
    }
  }
  for (let i = 0; i < voteInserts.length; i += BATCH_SIZE) {
    await db
      .insert(votes)
      .values(voteInserts.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing() // Skip duplicate votes (same principal + post)
  }
  console.log(`Created ${voteInserts.length} votes`)

  // Create comments
  console.log('Creating comments...')
  const commentInserts: (typeof comments.$inferInsert)[] = []
  for (const post of postRecords) {
    const numComments = Math.floor(Math.random() * 5) // 0-4 comments per post
    for (let c = 0; c < numComments; c++) {
      const author = pick(principals)
      commentInserts.push({
        postId: post.id,
        principalId: author.id,
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

  // Create changelog entries
  console.log('Creating changelog entries...')

  // Get posts with 'complete' status for linking
  const completePosts = postRecords.filter((p) => p.statusSlug === 'complete')
  let completePostIndex = 0

  const changelogInserts: (typeof changelogEntries.$inferInsert)[] = []
  const changelogPostInserts: (typeof changelogEntryPosts.$inferInsert)[] = []
  const adminPrincipals = principals.slice(0, 4) // First 4 principals are admins

  for (const preset of changelogPresets) {
    const changelogId: ChangelogId = generateId('changelog')
    const author = pick(adminPrincipals)

    let publishedAt: Date | null = null
    if (preset.status === 'published') {
      publishedAt = randomDate(preset.daysAgo ?? 30)
    } else if (preset.status === 'scheduled' && preset.daysAhead) {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + preset.daysAhead)
      publishedAt = futureDate
    }
    // Draft entries have null publishedAt

    changelogInserts.push({
      id: changelogId,
      title: preset.title,
      content: preset.content,
      contentJson: textToTipTapJson(preset.content),
      principalId: author.id,
      publishedAt,
      createdAt: publishedAt ?? new Date(),
      updatedAt: new Date(),
    })

    // Link 0-3 completed posts to some changelog entries (not all)
    // Published entries are more likely to have linked posts
    const shouldLink = preset.status === 'published' && Math.random() > 0.3
    if (shouldLink && completePosts.length > 0) {
      const numLinks = 1 + Math.floor(Math.random() * 3) // 1-3 posts
      for (let l = 0; l < numLinks && completePostIndex < completePosts.length; l++) {
        changelogPostInserts.push({
          changelogEntryId: changelogId,
          postId: completePosts[completePostIndex].id,
        })
        completePostIndex++
      }
    }
  }

  await db.insert(changelogEntries).values(changelogInserts)
  if (changelogPostInserts.length > 0) {
    await db.insert(changelogEntryPosts).values(changelogPostInserts)
  }
  console.log(
    `Created ${changelogInserts.length} changelog entries (${changelogPostInserts.length} linked to posts)`
  )

  console.log('\n✅ Seed complete!\n')
  console.log('Demo account:')
  console.log(`  Email: ${DEMO_USER.email}`)
  console.log(`  Password: ${DEMO_USER.password}\n`)
  console.log(`Portal: http://localhost:3000`)

  await client.end()
}

seed().catch(async (error) => {
  console.error('Seed failed:', error)
  await client.end()
  process.exitCode = 1
})
