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
  RawFeedbackItemId,
} from '@quackback/ids'
import { user, account, settings, principal } from './schema/auth'
import { boards, tags, roadmaps } from './schema/boards'
import { posts, postTags, postRoadmaps, votes, comments } from './schema/posts'
import { postStatuses, DEFAULT_STATUSES } from './schema/statuses'
import { changelogEntries, changelogEntryPosts } from './schema/changelog'
import { segments } from './schema/segments'
import type { SegmentRules } from './schema/segments'
import { feedbackSources, rawFeedbackItems, feedbackSignals } from './schema/feedback'
import type { RawFeedbackAuthor, RawFeedbackContent } from './types'

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

  // Check if posts already exist - skip post creation but continue to other sections
  const existingPostCount = await db.select({ id: posts.id }).from(posts).limit(1)
  if (existingPostCount.length > 0) {
    console.log('Posts already exist, skipping post creation')
  } else {
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
  } // end of "posts don't exist" block

  // Create default segments
  const existingSegments = await db.select({ id: segments.id }).from(segments).limit(1)
  if (existingSegments.length === 0) {
    const newUsersRules: SegmentRules = {
      match: 'all',
      conditions: [{ attribute: 'created_at_days_ago', operator: 'lt', value: 7 }],
    }
    const activeUsersRules: SegmentRules = {
      match: 'any',
      conditions: [
        { attribute: 'post_count', operator: 'gt', value: 0 },
        { attribute: 'comment_count', operator: 'gt', value: 0 },
        { attribute: 'vote_count', operator: 'gt', value: 0 },
      ],
    }
    await db.insert(segments).values([
      {
        id: generateId('segment'),
        name: 'New Users',
        description: 'Users who joined within the last 7 days',
        type: 'dynamic',
        color: '#3b82f6',
        rules: newUsersRules,
      },
      {
        id: generateId('segment'),
        name: 'Active Users',
        description: 'Users with at least one post, comment, or vote',
        type: 'dynamic',
        color: '#10b981',
        rules: activeUsersRules,
      },
    ])
    console.log('Created 2 default segments (New Users, Active Users)')
  }

  // ============================================
  // Feedback Aggregation Seed Data
  // ============================================

  const existingFeedbackSources = await db
    .select({ id: feedbackSources.id })
    .from(feedbackSources)
    .limit(1)
  if (existingFeedbackSources.length === 0) {
    console.log('Creating feedback aggregation data...')

    // Create feedback sources
    const quackbackSourceId = generateId('feedback_source')
    const slackSourceId = generateId('feedback_source')
    const zendeskSourceId = generateId('feedback_source')

    await db.insert(feedbackSources).values([
      {
        id: quackbackSourceId,
        sourceType: 'quackback',
        deliveryMode: 'passive',
        name: 'Quackback',
        enabled: true,
        config: {},
        lastSuccessAt: randomDate(1),
        errorCount: 0,
      },
      {
        id: slackSourceId,
        sourceType: 'slack',
        deliveryMode: 'webhook',
        name: 'Slack',
        enabled: true,
        config: { channelId: 'C01234ABCDE', channelName: '#product-feedback' },
        lastSuccessAt: randomDate(1),
        errorCount: 0,
      },
      {
        id: zendeskSourceId,
        sourceType: 'zendesk',
        deliveryMode: 'poll',
        name: 'Zendesk',
        enabled: true,
        config: { subdomain: 'acme', viewId: '360001234' },
        lastSuccessAt: randomDate(2),
        lastError: null,
        errorCount: 0,
      },
    ])
    console.log('Created 3 feedback sources')

    // Raw feedback items - realistic variety of states and sources
    const rawItemPresets: Array<{
      sourceId: typeof widgetSourceId
      sourceType: string
      author: RawFeedbackAuthor
      content: RawFeedbackContent
      state: string
      daysAgo: number
      externalUrl?: string
    }> = [
      {
        sourceId: slackSourceId,
        sourceType: 'slack',
        author: { name: 'Sarah Chen', email: 'sarah@bigcorp.com', externalUserId: 'U01SLACK1' },
        content: {
          subject: 'Dashboard loading times',
          text: 'The analytics dashboard takes 8-10 seconds to load for accounts with >1000 posts. Our team has been complaining about this daily. Is there any plan to optimize the queries? We love the product but this is becoming a dealbreaker for our power users.',
        },
        state: 'completed',
        daysAgo: 3,
        externalUrl: 'https://acme.slack.com/archives/C01234ABCDE/p1234567890',
      },
      {
        sourceId: quackbackSourceId,
        sourceType: 'quackback',
        author: { name: 'Marcus Johnson', email: 'marcus@startup.io' },
        content: {
          subject: 'Need bulk actions for posts',
          text: 'We have hundreds of posts that need to be moved between boards. Doing it one by one is incredibly tedious. Would love a multi-select + bulk move/tag/status change feature.',
        },
        state: 'completed',
        daysAgo: 5,
      },
      {
        sourceId: zendeskSourceId,
        sourceType: 'zendesk',
        author: {
          name: 'Emily Rodriguez',
          email: 'emily.r@enterprise.co',
          externalUserId: 'zen_user_42',
        },
        content: {
          subject: 'SSO login broken after update',
          text: 'Since the latest update, our SAML SSO flow fails with a 500 error on the callback. This is blocking all 200+ of our users from accessing the feedback portal. Urgent fix needed.',
        },
        state: 'completed',
        daysAgo: 1,
        externalUrl: 'https://acme.zendesk.com/agent/tickets/8842',
      },
      {
        sourceId: slackSourceId,
        sourceType: 'slack',
        author: { name: 'David Kim', email: 'dkim@agency.co', externalUserId: 'U01SLACK2' },
        content: {
          text: 'hey team, the export CSV feature is missing the vote counts column. that data is really important for our quarterly reports. can this be added?',
        },
        state: 'completed',
        daysAgo: 7,
      },
      {
        sourceId: quackbackSourceId,
        sourceType: 'quackback',
        author: { name: 'Rachel Thompson', email: 'rachel@freelance.com' },
        content: {
          subject: 'Dark mode for embedded widget',
          text: 'The feedback widget really clashes with our dark-themed website. The bright white popup is jarring. Would be great if the widget could detect or respect prefers-color-scheme.',
        },
        state: 'completed',
        daysAgo: 4,
      },
      {
        sourceId: zendeskSourceId,
        sourceType: 'zendesk',
        author: { name: 'Alex Martinez', email: 'alex@scaleup.com', externalUserId: 'zen_user_78' },
        content: {
          subject: 'API rate limiting too aggressive',
          text: 'We hit rate limits within 5 minutes of syncing our feedback data. With 50k+ users submitting feedback, the current 100 req/min limit is way too low. Can we get higher limits or a batch endpoint?',
        },
        state: 'completed',
        daysAgo: 6,
        externalUrl: 'https://acme.zendesk.com/agent/tickets/9103',
      },
      {
        sourceId: slackSourceId,
        sourceType: 'slack',
        author: { name: 'Jordan Lee', email: 'jordan@devshop.io', externalUserId: 'U01SLACK3' },
        content: {
          text: 'Just discovered the changelog feature - absolutely love it! The way it links back to the original feature requests is brilliant. Our users are thrilled to see their feedback turn into real features.',
        },
        state: 'completed',
        daysAgo: 2,
      },
      {
        sourceId: quackbackSourceId,
        sourceType: 'quackback',
        author: { name: 'Taylor Wilson', email: 'taylor@saas.com' },
        content: {
          subject: 'Merge duplicate posts',
          text: 'We keep getting duplicate feature requests and there is no way to merge them. This makes it look like popular requests have fewer votes than they actually do. A merge feature with vote aggregation would be huge.',
        },
        state: 'completed',
        daysAgo: 8,
      },
      {
        sourceId: zendeskSourceId,
        sourceType: 'zendesk',
        author: { name: 'Casey Brown', email: 'casey@retailco.com', externalUserId: 'zen_user_55' },
        content: {
          subject: 'Mobile responsive issues',
          text: 'The admin dashboard is nearly unusable on tablets. The sidebar overlaps the content area and buttons are too small to tap. Our PMs often review feedback on iPads during meetings.',
        },
        state: 'completed',
        daysAgo: 10,
        externalUrl: 'https://acme.zendesk.com/agent/tickets/8567',
      },
      {
        sourceId: slackSourceId,
        sourceType: 'slack',
        author: { name: 'Morgan Davis', email: 'morgan@pm-team.co', externalUserId: 'U01SLACK4' },
        content: {
          text: 'The roadmap view needs a timeline/gantt visualization. Right now it is just a kanban which does not show when things will ship. Our stakeholders keep asking for target dates and I have no good way to show them.',
        },
        state: 'completed',
        daysAgo: 3,
      },
      // Some items in various processing states for the Stream view
      {
        sourceId: quackbackSourceId,
        sourceType: 'quackback',
        author: { name: 'Riley Garcia', email: 'riley@newuser.com' },
        content: {
          subject: 'Webhook documentation unclear',
          text: 'The webhook docs are missing examples for the post.status_changed event payload. I spent 2 hours trying to parse the data before giving up and asking support.',
        },
        state: 'ready_for_extraction',
        daysAgo: 0,
      },
      {
        sourceId: slackSourceId,
        sourceType: 'slack',
        author: { name: 'Quinn Anderson', email: 'quinn@techcorp.io', externalUserId: 'U01SLACK5' },
        content: {
          text: 'Can we get email digest notifications? Getting individual emails for every vote and comment is overwhelming. A daily or weekly summary would be much better.',
        },
        state: 'extracting',
        daysAgo: 0,
      },
      {
        sourceId: zendeskSourceId,
        sourceType: 'zendesk',
        author: {
          name: 'Avery Moore',
          email: 'avery@consulting.biz',
          externalUserId: 'zen_user_91',
        },
        content: {
          subject: 'Custom fields on posts',
          text: 'We need to add custom metadata fields to posts - things like customer tier, revenue impact, and effort estimate. This would help us prioritize feedback using our internal scoring model.',
        },
        state: 'pending_context',
        daysAgo: 0,
        externalUrl: 'https://acme.zendesk.com/agent/tickets/9244',
      },
      {
        sourceId: quackbackSourceId,
        sourceType: 'quackback',
        author: { name: 'Blake Taylor', email: 'blake@fails.com' },
        content: {
          subject: 'Integration with Linear',
          text: 'Please add a Linear integration so we can automatically create issues from feedback posts. Right now we copy-paste everything manually which is error-prone.',
        },
        state: 'failed',
        daysAgo: 1,
      },
    ]

    const rawItemIds: RawFeedbackItemId[] = []
    for (const preset of rawItemPresets) {
      const itemId = generateId('raw_feedback')
      rawItemIds.push(itemId)
      await db.insert(rawFeedbackItems).values({
        id: itemId,
        sourceId: preset.sourceId,
        sourceType: preset.sourceType,
        externalId: `ext_${crypto.randomUUID().slice(0, 8)}`,
        dedupeKey: `${preset.sourceType}:${crypto.randomUUID().slice(0, 12)}`,
        externalUrl: preset.externalUrl,
        sourceCreatedAt: randomDate(preset.daysAgo),
        author: preset.author,
        content: preset.content,
        processingState: preset.state,
        stateChangedAt: randomDate(preset.daysAgo),
        processedAt: preset.state === 'completed' ? randomDate(preset.daysAgo) : null,
        attemptCount: preset.state === 'failed' ? 3 : preset.state === 'completed' ? 1 : 0,
        lastError:
          preset.state === 'failed'
            ? 'AI extraction failed: context length exceeded (8192 tokens)'
            : null,
        principalId: principals[Math.floor(Math.random() * principals.length)].id,
      })
    }
    console.log(`Created ${rawItemPresets.length} raw feedback items`)

    // Create signals
    const signalPresets = [
      {
        rawItemIdx: 0,
        boardIdx: 0,
        signalType: 'usability_issue',
        summary: 'Dashboard loading takes 8-10s for large accounts (>1000 posts)',
        implicitNeed: 'Faster query performance for high-volume accounts',
        evidence: [
          'The analytics dashboard takes 8-10 seconds to load',
          'becoming a dealbreaker for our power users',
        ],
        sentiment: 'negative',
        urgency: 'high',
        confidence: 0.92,
      },
      {
        rawItemIdx: 5,
        boardIdx: 0,
        signalType: 'feature_request',
        summary: 'API rate limits too low for large-scale data sync',
        implicitNeed: 'Higher throughput for enterprise integrations',
        evidence: ['hit rate limits within 5 minutes', 'current 100 req/min limit is way too low'],
        sentiment: 'negative',
        urgency: 'critical',
        confidence: 0.88,
      },
      {
        rawItemIdx: 8,
        boardIdx: 0,
        signalType: 'usability_issue',
        summary: 'Admin dashboard unusable on tablets due to layout issues',
        implicitNeed: 'Responsive design for mobile/tablet admin usage',
        evidence: ['sidebar overlaps the content area', 'buttons are too small to tap'],
        sentiment: 'negative',
        urgency: 'medium',
        confidence: 0.85,
      },
      {
        rawItemIdx: 1,
        boardIdx: 0,
        signalType: 'feature_request',
        summary: 'Multi-select and bulk move/tag/status change for posts',
        implicitNeed: 'Efficient batch operations for managing large volumes of posts',
        evidence: [
          'hundreds of posts that need to be moved between boards',
          'Doing it one by one is incredibly tedious',
        ],
        sentiment: 'negative',
        urgency: 'high',
        confidence: 0.95,
      },
      {
        rawItemIdx: 7,
        boardIdx: 0,
        signalType: 'feature_request',
        summary: 'Merge duplicate posts with vote count aggregation',
        implicitNeed: 'Accurate representation of feature request popularity',
        evidence: [
          'duplicate feature requests and there is no way to merge them',
          'popular requests have fewer votes than they actually do',
        ],
        sentiment: 'negative',
        urgency: 'medium',
        confidence: 0.91,
      },
      {
        rawItemIdx: 8,
        boardIdx: 1,
        signalType: 'bug_report',
        summary: 'Admin dashboard layout broken on iPad - sidebar overlaps content',
        implicitNeed: 'Tablet-friendly admin interface for on-the-go PM workflows',
        evidence: [
          'nearly unusable on tablets',
          'PMs often review feedback on iPads during meetings',
        ],
        sentiment: 'negative',
        urgency: 'high',
        confidence: 0.89,
      },
      {
        rawItemIdx: 3,
        boardIdx: 3,
        signalType: 'bug_report',
        summary: 'CSV export missing vote counts column',
        implicitNeed: 'Complete data export for reporting and analysis',
        evidence: ['missing the vote counts column', 'important for our quarterly reports'],
        sentiment: 'negative',
        urgency: 'medium',
        confidence: 0.87,
      },
      {
        rawItemIdx: 5,
        boardIdx: 3,
        signalType: 'feature_request',
        summary: 'Need batch API endpoint for high-volume data sync',
        implicitNeed: 'Scalable API for enterprise data integration workflows',
        evidence: ['Can we get higher limits or a batch endpoint'],
        sentiment: 'neutral',
        urgency: 'high',
        confidence: 0.83,
      },
      {
        rawItemIdx: 10,
        boardIdx: 3,
        signalType: 'usability_issue',
        summary: 'Webhook documentation missing payload examples for events',
        implicitNeed: 'Clear developer documentation with concrete examples',
        evidence: [
          'missing examples for the post.status_changed event payload',
          'spent 2 hours trying to parse',
        ],
        sentiment: 'neutral',
        urgency: 'medium',
        confidence: 0.79,
      },
      {
        rawItemIdx: 9,
        boardIdx: 0,
        signalType: 'feature_request',
        summary: 'Timeline/Gantt visualization for roadmaps with target dates',
        implicitNeed: 'Date-driven planning and stakeholder communication',
        evidence: [
          'needs a timeline/gantt visualization',
          'stakeholders keep asking for target dates',
        ],
        sentiment: 'negative',
        urgency: 'medium',
        confidence: 0.9,
      },
      {
        rawItemIdx: 11,
        boardIdx: 0,
        signalType: 'feature_request',
        summary: 'Email digest mode for daily/weekly notification summaries',
        implicitNeed: 'Manageable notification volume without missing important updates',
        evidence: ['Getting individual emails for every vote and comment is overwhelming'],
        sentiment: 'neutral',
        urgency: 'low',
        confidence: 0.86,
      },
      {
        rawItemIdx: 4,
        boardIdx: 0,
        signalType: 'feature_request',
        summary: 'Widget dark mode with prefers-color-scheme detection',
        implicitNeed: 'Visual consistency between widget and host site theming',
        evidence: ['bright white popup is jarring', 'respect prefers-color-scheme'],
        sentiment: 'neutral',
        urgency: 'medium',
        confidence: 0.88,
      },
      {
        rawItemIdx: 6,
        boardIdx: 2,
        signalType: 'praise',
        summary: 'Changelog feature and feedback-to-feature loop highly valued',
        implicitNeed: 'Continue investing in the feedback loop closure experience',
        evidence: [
          'absolutely love it',
          'links back to the original feature requests is brilliant',
        ],
        sentiment: 'positive',
        urgency: 'low',
        confidence: 0.94,
      },
    ]

    for (const preset of signalPresets) {
      await db.insert(feedbackSignals).values({
        rawFeedbackItemId: rawItemIds[preset.rawItemIdx],
        signalType: preset.signalType,
        summary: preset.summary,
        evidence: preset.evidence,
        implicitNeed: preset.implicitNeed,
        sentiment: preset.sentiment,
        urgency: preset.urgency,
        boardId: boardIds[preset.boardIdx],
        extractionConfidence: preset.confidence,
        interpretationConfidence: preset.confidence * 0.95,
        processingState: 'completed',
        extractionModel: 'gpt-4o',
        extractionPromptVersion: 'v1',
        interpretationModel: 'gpt-4o',
        interpretationPromptVersion: 'v1',
      })
    }
    console.log(`Created ${signalPresets.length} feedback signals`)
  } else {
    console.log('Feedback data already exists, skipping')
  }

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
