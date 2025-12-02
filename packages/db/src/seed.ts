/**
 * Database seed script for development.
 * Creates realistic demo data using Faker for testing.
 *
 * Usage: bun run db:seed
 */
import { config } from 'dotenv'
config({ path: '../../.env', quiet: true })

import { faker } from '@faker-js/faker'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { user, organization, member, account } from './schema/auth'
import { boards, tags, roadmaps } from './schema/boards'
import { posts, postTags, postRoadmaps, comments, votes } from './schema/posts'

const connectionString = process.env.DATABASE_URL!
const client = postgres(connectionString)
const db = drizzle(client)

// Configuration
const CONFIG = {
  users: 15,
  orgsPerUser: 1, // Demo user owns 1 org, others are members
  boardsPerOrg: 3,
  postsPerBoard: { min: 8, max: 15 },
  commentsPerPost: { min: 0, max: 5 },
  votesPerPost: { min: 0, max: 50 },
}

// Fixed demo credentials
const DEMO_USER = {
  email: 'demo@example.com',
  password: '$2a$10$K7L1OJ45/4Y2nIvhRVpCe.FSmhDdWoXehVzJptJ/op0lLfy0aVc4.', // demo1234
  name: 'Demo User',
}

const DEMO_ORG = {
  name: 'Acme Corp',
  slug: 'acme',
}

// Feedback-specific content generators
const feedbackTitles = [
  () => `Add ${faker.word.adjective()} ${faker.word.noun()} feature`,
  () => `${faker.word.verb({ capitalize: true })} ${faker.word.noun()} improvement`,
  () => `Support for ${faker.company.buzzNoun()}`,
  () => `Integration with ${faker.company.name()}`,
  () => `${faker.hacker.verb({ capitalize: true })} the ${faker.hacker.noun()}`,
  () => `Better ${faker.word.noun()} management`,
  () => `${faker.word.adjective({ capitalize: true })} mode option`,
  () => `Export to ${faker.system.fileExt().toUpperCase()} format`,
  () => `Keyboard shortcuts for ${faker.word.noun()}`,
  () => `${faker.word.verb({ capitalize: true })} notifications`,
  () => `Mobile ${faker.word.noun()} support`,
  () => `Bulk ${faker.word.verb()} functionality`,
  () => `${faker.word.adjective({ capitalize: true })} dashboard widgets`,
  () => `API endpoint for ${faker.word.noun()}`,
  () => `${faker.word.noun({ capitalize: true })} analytics`,
]

const feedbackContent = [
  () =>
    `It would be great to have ${faker.word.adjective()} ${faker.word.noun()} support. ${faker.lorem.sentences(2)}`,
  () =>
    `As a ${faker.person.jobType()}, I need the ability to ${faker.hacker.verb()} ${faker.hacker.noun()}. ${faker.lorem.sentences(2)}`,
  () => `Many users have requested ${faker.word.noun()} functionality. ${faker.lorem.sentences(3)}`,
  () =>
    `This would significantly improve ${faker.word.noun()} workflow. ${faker.lorem.paragraph()}`,
  () => `${faker.lorem.paragraphs(2)}`,
  () =>
    `Currently there's no way to ${faker.hacker.verb()} the ${faker.hacker.noun()}. ${faker.lorem.sentences(2)} This is critical for our team.`,
  () =>
    `We've been waiting for this feature since ${faker.date.past({ years: 1 }).toLocaleDateString()}. ${faker.lorem.sentences(2)}`,
]

const commentContent = [
  () => `+1, this would be amazing!`,
  () => `${faker.lorem.sentence()} Really looking forward to this.`,
  () => `Great suggestion! We use ${faker.company.name()} and this would help a lot.`,
  () => `Any updates on this? ${faker.lorem.sentence()}`,
  () => `This is exactly what we need. ${faker.lorem.sentences(2)}`,
  () => `Voted! ${faker.lorem.sentence()}`,
  () => `Our team would benefit greatly from this feature.`,
  () => `${faker.lorem.paragraph()}`,
  () => `Is there a workaround for this in the meantime?`,
  () => `We've been using ${faker.company.buzzPhrase()} as a temporary solution.`,
]

const tagPresets = [
  { name: 'Bug', color: '#ef4444' },
  { name: 'Feature', color: '#3b82f6' },
  { name: 'Enhancement', color: '#8b5cf6' },
  { name: 'UX', color: '#ec4899' },
  { name: 'Performance', color: '#f59e0b' },
  { name: 'Documentation', color: '#6b7280' },
  { name: 'Security', color: '#dc2626' },
  { name: 'Integration', color: '#14b8a6' },
  { name: 'Mobile', color: '#06b6d4' },
  { name: 'API', color: '#84cc16' },
]

const boardPresets = [
  {
    name: 'Feature Requests',
    slug: 'features',
    description: 'Vote on and discuss new feature ideas',
  },
  { name: 'Bug Reports', slug: 'bugs', description: 'Report and track bugs' },
  {
    name: 'General Feedback',
    slug: 'feedback',
    description: 'Share your thoughts and suggestions',
  },
  {
    name: 'Integrations',
    slug: 'integrations',
    description: 'Request and discuss third-party integrations',
  },
  {
    name: 'UX Improvements',
    slug: 'ux',
    description: 'User experience and design feedback',
  },
]

type PostStatus = 'open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed'

// Helpers
function uuid() {
  return crypto.randomUUID()
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function pickMultiple<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomDate(daysAgo: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - Math.floor(Math.random() * daysAgo))
  date.setHours(randomInt(0, 23), randomInt(0, 59), randomInt(0, 59))
  return date
}

function weightedStatus(): PostStatus {
  const weights = {
    open: 30,
    under_review: 20,
    planned: 20,
    in_progress: 15,
    complete: 10,
    closed: 5,
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  let random = Math.random() * total
  for (const [status, weight] of Object.entries(weights)) {
    random -= weight
    if (random <= 0) return status as PostStatus
  }
  return 'open'
}

async function seed() {
  console.log('🌱 Seeding database with faker data...\n')

  // Check if demo user already exists
  const existingUser = await db.select().from(user).where(eq(user.email, DEMO_USER.email))
  if (existingUser.length > 0) {
    console.log('Demo data already exists. To re-seed, run:')
    console.log('  bun run db:reset && bun run db:seed\n')
    await client.end()
    process.exit(0)
  }

  // =========================================================================
  // Create Users
  // =========================================================================
  console.log('👤 Creating users...')

  const demoUserId = uuid()
  const userRecords: Array<{ id: string; name: string; email: string }> = []

  // Create demo user (fixed credentials)
  await db.insert(user).values({
    id: demoUserId,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await db.insert(account).values({
    id: uuid(),
    accountId: demoUserId,
    providerId: 'credential',
    userId: demoUserId,
    password: DEMO_USER.password,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  userRecords.push({ id: demoUserId, name: DEMO_USER.name, email: DEMO_USER.email })

  // Create random users
  for (let i = 0; i < CONFIG.users; i++) {
    const userId = uuid()
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()
    const name = `${firstName} ${lastName}`
    const email = faker.internet.email({ firstName, lastName }).toLowerCase()

    await db.insert(user).values({
      id: userId,
      name,
      email,
      emailVerified: faker.datatype.boolean({ probability: 0.8 }),
      image: faker.datatype.boolean({ probability: 0.6 }) ? faker.image.avatar() : null,
      createdAt: randomDate(180),
      updatedAt: new Date(),
    })

    // Some users have password accounts
    if (faker.datatype.boolean({ probability: 0.7 })) {
      await db.insert(account).values({
        id: uuid(),
        accountId: userId,
        providerId: 'credential',
        userId: userId,
        password: DEMO_USER.password, // Same password for testing
        createdAt: randomDate(180),
        updatedAt: new Date(),
      })
    }

    userRecords.push({ id: userId, name, email })
  }

  console.log(`   Created ${userRecords.length} users`)

  // =========================================================================
  // Create Organizations
  // =========================================================================
  console.log('🏢 Creating organizations...')

  const orgRecords: Array<{ id: string; name: string; slug: string }> = []

  // Create demo org (owned by demo user)
  const demoOrgId = uuid()
  await db.insert(organization).values({
    id: demoOrgId,
    name: DEMO_ORG.name,
    slug: DEMO_ORG.slug,
    logo: null,
    createdAt: new Date(),
  })

  await db.insert(member).values({
    id: uuid(),
    organizationId: demoOrgId,
    userId: demoUserId,
    role: 'owner',
    createdAt: new Date(),
  })

  orgRecords.push({ id: demoOrgId, name: DEMO_ORG.name, slug: DEMO_ORG.slug })

  // Add some random users as members of demo org
  const demoOrgMembers = pickMultiple(
    userRecords.filter((u) => u.id !== demoUserId),
    randomInt(5, 10)
  )
  for (const memberUser of demoOrgMembers) {
    await db.insert(member).values({
      id: uuid(),
      organizationId: demoOrgId,
      userId: memberUser.id,
      role: pick(['admin', 'member', 'member', 'member']), // More members than admins
      createdAt: randomDate(90),
    })
  }

  // Create additional orgs
  const additionalOrgNames = [faker.company.name(), faker.company.name()]
  const additionalOrgs = additionalOrgNames.map((name) => ({
    name,
    slug: faker.helpers
      .slugify(name)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 20),
  }))

  for (const orgData of additionalOrgs) {
    const orgId = uuid()
    const owner = pick(userRecords.filter((u) => u.id !== demoUserId))

    await db.insert(organization).values({
      id: orgId,
      name: orgData.name,
      slug: orgData.slug,
      createdAt: randomDate(120),
    })

    await db.insert(member).values({
      id: uuid(),
      organizationId: orgId,
      userId: owner.id,
      role: 'owner',
      createdAt: randomDate(120),
    })

    // Add demo user as member of other orgs (for testing org switching)
    await db.insert(member).values({
      id: uuid(),
      organizationId: orgId,
      userId: demoUserId,
      role: 'member',
      createdAt: randomDate(60),
    })

    orgRecords.push({ id: orgId, ...orgData })
  }

  console.log(`   Created ${orgRecords.length} organizations`)

  // =========================================================================
  // Create Tags (per organization)
  // =========================================================================
  console.log('🏷️  Creating tags...')

  const tagRecords: Map<string, Array<{ id: string; name: string; color: string }>> = new Map()

  for (const org of orgRecords) {
    const orgTags: Array<{ id: string; name: string; color: string }> = []
    const selectedTags = pickMultiple(tagPresets, randomInt(5, tagPresets.length))

    for (const tagData of selectedTags) {
      const tagId = uuid()
      await db.insert(tags).values({
        id: tagId,
        organizationId: org.id,
        name: tagData.name,
        color: tagData.color,
      })
      orgTags.push({ id: tagId, ...tagData })
    }

    tagRecords.set(org.id, orgTags)
  }

  console.log(`   Created tags for ${orgRecords.length} organizations`)

  // =========================================================================
  // Create Boards (per organization)
  // =========================================================================
  console.log('📋 Creating boards...')

  const boardRecords: Map<string, Array<{ id: string; slug: string; name: string }>> = new Map()

  for (const org of orgRecords) {
    const orgBoards: Array<{ id: string; slug: string; name: string }> = []
    const selectedBoards = pickMultiple(boardPresets, CONFIG.boardsPerOrg)

    for (const boardData of selectedBoards) {
      const boardId = uuid()
      await db.insert(boards).values({
        id: boardId,
        organizationId: org.id,
        slug: boardData.slug,
        name: boardData.name,
        description: boardData.description,
        isPublic: true,
        createdAt: randomDate(90),
      })
      orgBoards.push({ id: boardId, slug: boardData.slug, name: boardData.name })
    }

    boardRecords.set(org.id, orgBoards)
  }

  console.log(`   Created ${CONFIG.boardsPerOrg} boards per organization`)

  // =========================================================================
  // Create Roadmaps (per board)
  // =========================================================================
  console.log('🗺️  Creating roadmaps...')

  const roadmapRecords: Map<string, { id: string; name: string }> = new Map()

  for (const org of orgRecords) {
    const orgBoards = boardRecords.get(org.id) || []
    for (const board of orgBoards) {
      // 70% chance of having a roadmap
      if (faker.datatype.boolean({ probability: 0.7 })) {
        const roadmapId = uuid()
        await db.insert(roadmaps).values({
          id: roadmapId,
          boardId: board.id,
          slug: 'roadmap',
          name: `${board.name} Roadmap`,
          description: `Public roadmap for ${board.name.toLowerCase()}`,
          isPublic: true,
          createdAt: randomDate(60),
        })
        roadmapRecords.set(board.id, { id: roadmapId, name: `${board.name} Roadmap` })
      }
    }
  }

  console.log(`   Created ${roadmapRecords.size} roadmaps`)

  // =========================================================================
  // Create Posts
  // =========================================================================
  console.log('📝 Creating posts...')

  let totalPosts = 0
  const postRecords: Array<{ id: string; boardId: string; orgId: string }> = []

  for (const org of orgRecords) {
    const orgBoards = boardRecords.get(org.id) || []
    const orgTags = tagRecords.get(org.id) || []
    const orgMembers = userRecords.filter(() =>
      org.id === demoOrgId ? true : faker.datatype.boolean({ probability: 0.3 })
    )

    for (const board of orgBoards) {
      const postCount = randomInt(CONFIG.postsPerBoard.min, CONFIG.postsPerBoard.max)

      for (let i = 0; i < postCount; i++) {
        const postId = uuid()
        const author = pick(orgMembers)
        const isAnonymous = faker.datatype.boolean({ probability: 0.15 })
        const status = weightedStatus()
        const createdAt = randomDate(120)
        const voteCount = randomInt(CONFIG.votesPerPost.min, CONFIG.votesPerPost.max)

        await db.insert(posts).values({
          id: postId,
          boardId: board.id,
          title: pick(feedbackTitles)(),
          content: pick(feedbackContent)(),
          authorId: isAnonymous ? null : author.id,
          authorName: isAnonymous ? 'Anonymous' : author.name,
          authorEmail: isAnonymous ? null : author.email,
          status,
          voteCount,
          ownerId: faker.datatype.boolean({ probability: 0.4 }) ? pick(orgMembers).id : null,
          estimatedSize: faker.datatype.boolean({ probability: 0.3 })
            ? pick(['small', 'medium', 'large'])
            : null,
          createdAt,
          updatedAt: new Date(),
        })

        postRecords.push({ id: postId, boardId: board.id, orgId: org.id })
        totalPosts++

        // Add tags to post (0-3 tags)
        const postTagCount = randomInt(0, 3)
        if (postTagCount > 0 && orgTags.length > 0) {
          const selectedTags = pickMultiple(orgTags, Math.min(postTagCount, orgTags.length))
          for (const tag of selectedTags) {
            await db.insert(postTags).values({
              id: uuid(),
              postId,
              tagId: tag.id,
            })
          }
        }

        // Add to roadmap if status is planned/in_progress/complete
        const roadmap = roadmapRecords.get(board.id)
        if (roadmap && ['planned', 'in_progress', 'complete'].includes(status)) {
          if (faker.datatype.boolean({ probability: 0.7 })) {
            await db.insert(postRoadmaps).values({
              id: uuid(),
              postId,
              roadmapId: roadmap.id,
            })
          }
        }
      }
    }
  }

  console.log(`   Created ${totalPosts} posts`)

  // =========================================================================
  // Create Comments
  // =========================================================================
  console.log('💬 Creating comments...')

  let totalComments = 0

  for (const post of postRecords) {
    const commentCount = randomInt(CONFIG.commentsPerPost.min, CONFIG.commentsPerPost.max)
    const relevantUsers = userRecords.filter(() => faker.datatype.boolean({ probability: 0.5 }))

    for (let i = 0; i < commentCount; i++) {
      const author = pick(relevantUsers.length > 0 ? relevantUsers : userRecords)
      const isAnonymous = faker.datatype.boolean({ probability: 0.2 })

      await db.insert(comments).values({
        id: uuid(),
        postId: post.id,
        authorId: isAnonymous ? null : author.id,
        authorName: isAnonymous ? faker.person.fullName() : author.name,
        authorEmail: isAnonymous ? faker.internet.email().toLowerCase() : author.email,
        content: pick(commentContent)(),
        createdAt: randomDate(60),
      })

      totalComments++
    }
  }

  console.log(`   Created ${totalComments} comments`)

  // =========================================================================
  // Create Votes
  // =========================================================================
  console.log('👍 Creating votes...')

  let totalVotes = 0

  for (const post of postRecords) {
    // Create votes matching roughly the voteCount (some variance is fine)
    const voters = pickMultiple(userRecords, randomInt(1, Math.min(15, userRecords.length)))

    for (const voter of voters) {
      // Use either the user ID or an anonymous identifier
      const userIdentifier = faker.datatype.boolean({ probability: 0.7 })
        ? voter.id
        : `anon_${faker.string.alphanumeric(16)}`

      await db.insert(votes).values({
        id: uuid(),
        postId: post.id,
        userIdentifier,
        createdAt: randomDate(90),
      })

      totalVotes++
    }
  }

  console.log(`   Created ${totalVotes} votes`)

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n✅ Seed complete!\n')
  console.log('━'.repeat(50))
  console.log('Demo credentials:')
  console.log(`  Email:    ${DEMO_USER.email}`)
  console.log('  Password: demo1234')
  console.log('')
  console.log('Organizations:')
  for (const org of orgRecords) {
    console.log(`  • ${org.name}`)
    console.log(`    http://${org.slug}.quackback.localhost:3000`)
  }
  console.log('')
  console.log('Summary:')
  console.log(`  • ${userRecords.length} users`)
  console.log(`  • ${orgRecords.length} organizations`)
  console.log(`  • ${totalPosts} posts`)
  console.log(`  • ${totalComments} comments`)
  console.log(`  • ${totalVotes} votes`)
  console.log('━'.repeat(50))

  await client.end()
}

seed().catch(async (error) => {
  console.error('Seed failed:', error)
  await client.end()
  process.exitCode = 1
})
