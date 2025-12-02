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
import { scrypt } from '@noble/hashes/scrypt.js'
import { user, organization, member, account } from './schema/auth'
import { boards, tags, roadmaps } from './schema/boards'
import { posts, postTags, postRoadmaps, comments, votes } from './schema/posts'

const connectionString = process.env.DATABASE_URL!
const client = postgres(connectionString)
const db = drizzle(client)

// Hash password using better-auth's scrypt format
function hashPassword(password: string): string {
  const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex')
  const key = scrypt(password.normalize('NFKC'), salt, {
    N: 16384,
    r: 16,
    p: 1,
    dkLen: 64,
  })
  return `${salt}:${Buffer.from(key).toString('hex')}`
}

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
  password: 'demo1234',
  name: 'Demo User',
}

const DEMO_ORG = {
  name: 'Acme Corp',
  slug: 'acme',
}

// Realistic feedback titles based on common SaaS feature requests
const feedbackTitles = [
  // Integrations
  'Slack integration for notifications',
  'Connect with Google Calendar',
  'Zapier integration',
  'GitHub issue sync',
  'Jira two-way sync',
  'Microsoft Teams notifications',
  'Discord webhook support',
  'Notion integration',
  'Linear integration',
  'Salesforce CRM integration',
  'HubSpot integration',
  'Intercom integration',

  // Export/Import
  'Export to CSV',
  'Export to PDF reports',
  'Bulk import from spreadsheet',
  'Export data to JSON',
  'Import from Trello',
  'Import from Canny',
  'Weekly digest email export',

  // UI/UX
  'Dark mode support',
  'Mobile app',
  'Keyboard shortcuts',
  'Customizable dashboard',
  'Drag and drop reordering',
  'Collapsible sidebar',
  'Full-screen mode',
  'Better mobile experience',
  'Compact view option',
  'Card view vs list view toggle',
  'Custom themes',
  'Accessibility improvements',
  'RTL language support',

  // Features
  'Add voting on comments',
  'Merge duplicate posts',
  'Private boards for internal feedback',
  'Custom fields on posts',
  'Post templates',
  'Scheduled posts',
  'AI-powered duplicate detection',
  'Sentiment analysis',
  'Anonymous voting option',
  'Email notifications for status changes',
  'Roadmap timeline view',
  'Gantt chart view',
  'Custom status labels',
  'Priority levels',
  'Post categories/folders',
  'Bulk actions on posts',
  'Search within posts',
  'Advanced filtering',
  'Saved filters',
  'Custom sorting options',

  // API/Developer
  'Public API access',
  'Webhooks for events',
  'SSO/SAML support',
  'API rate limit increase',
  'GraphQL API',
  'Embeddable widget',
  'White-label option',

  // Team/Collaboration
  'Assign posts to team members',
  'Internal notes on posts',
  'Team activity log',
  'Role-based permissions',
  'Approval workflow',
  'Comment mentions (@user)',
  'Team inbox',

  // Analytics
  'Analytics dashboard',
  'Vote trends over time',
  'User engagement metrics',
  'Export analytics data',
  'Custom reports',
  'NPS score tracking',

  // Bugs (for bug boards)
  'Login page not loading on Safari',
  'Email notifications delayed',
  'Images not displaying correctly',
  'Search returns no results',
  'Page crashes when filtering',
  'Cannot upload large files',
  'Timezone issues with dates',
  'Password reset email not received',
  'Slow loading on mobile',
  '500 error when saving post',
]

// Realistic feedback content - real English, no lorem ipsum
const feedbackContent = [
  // Short and direct
  'Would love to see this added! It would save us so much time.',
  'This is a must-have for our team. We currently have to use a separate tool for this.',
  'Please prioritize this! Many of us have been asking for this feature.',
  "Is this on the roadmap? We'd really benefit from this functionality.",
  '+1 from our team. This would be a game-changer for our workflow.',

  // Detailed use case
  `We're a team of 15 and we use the product daily. This feature would help us streamline our process significantly. Right now we have to export data manually and it takes about 2 hours per week.`,
  `As a product manager, I need this to better communicate with stakeholders. Currently I'm taking screenshots and pasting them into slides which is not ideal.`,
  `Our customers keep asking us about this. Would be great to have it built-in rather than pointing them to third-party solutions.`,
  `We evaluated several tools before choosing yours, and this was the one feature we were hoping you'd add. It's not a dealbreaker but would definitely make our lives easier.`,

  // Problem-focused
  `The current workaround is pretty tedious. I have to:\n1. Export the data\n2. Open it in Excel\n3. Reformat everything\n4. Import it into the other system\n\nA direct integration would eliminate all of this.`,
  `We've tried using the API for this but it's not quite flexible enough. A native solution would be much better.`,
  `This has been a pain point for us since we started using the platform. Would really appreciate seeing this addressed.`,

  // With context
  `Coming from Notion, this is the one thing I miss. Would make the transition complete for our team.`,
  `We're a startup with limited resources, so anything that saves time is valuable. This would probably save us 5+ hours per week.`,
  `I've talked to other users in the community and this seems to be a common request. Happy to help beta test if you need feedback!`,

  // Enthusiastic
  `This would be AMAZING! 🙌 We've been hoping for this since we signed up.`,
  `Yes please! Take my money 💰 - would happily pay extra for this feature.`,
  `Been waiting for this! Would make the product 10x more useful for our use case.`,

  // Professional/enterprise
  `This is a requirement for our enterprise security team. Without it, we may need to evaluate alternatives.`,
  `We're planning to roll this out to 500+ users but need this feature first. Happy to discuss our requirements in more detail.`,
  `Our compliance team has flagged this as necessary for SOC 2. Can you share an ETA?`,

  // Bug report style
  `Steps to reproduce:\n1. Go to the dashboard\n2. Click on the filter dropdown\n3. Select multiple options\n4. The page freezes\n\nThis happens consistently on Chrome and Firefox.`,
  `This started happening after the last update. Was working fine before. Not sure if related but wanted to flag it.`,
  `Seeing this issue intermittently. Happens maybe 1 in 5 times. Happy to provide more details or a screen recording if helpful.`,

  // With alternatives considered
  `I know you can kind of do this with the API, but a native solution would be much more accessible for non-technical team members.`,
  `We looked at building this ourselves using webhooks but it's quite complex. Would prefer an official solution.`,
]

// Realistic comment content - varied tones, some with emoji
const commentContent = [
  // Simple reactions
  '+1',
  '+1 from us too!',
  '👍',
  '🙌 Yes please!',
  'Need this!',
  'Same here',
  'Upvoted!',
  'Following this thread',
  'Bumping this - still very much needed',

  // Agreements with context
  'This would be huge for our team.',
  "We need this too. Currently using a hacky workaround that's not ideal.",
  'Agreed! This is one of the most requested features in our org.',
  'We switched from a competitor specifically hoping you had this. Please prioritize!',
  "Adding my vote. We've got about 50 users who would benefit from this.",

  // Questions
  'Any ETA on this?',
  'Is this being worked on? Would love an update.',
  "Curious if there's a workaround in the meantime?",
  'Would this work with the existing API or require changes?',
  'Has anyone found a third-party solution for this?',

  // Status check-ins
  "@team - any update on this? It's been a few months.",
  'Just checking in on this one. Still a top priority for us.',
  'Noticed this moved to "Under Review" - exciting! 🎉',
  'Saw this is now "Planned" - thank you for listening! ❤️',

  // Constructive feedback
  'Great idea! One addition - it would be nice if it also supported bulk operations.',
  "Love this suggestion. For our use case, we'd also need it to handle edge cases like deleted users.",
  'If you implement this, please make it optional/configurable. Not everyone will want it on by default.',
  'Would be great if this integrated with the existing notification system too.',

  // Workarounds
  "For anyone looking for a workaround, I've been using Zapier to handle this. Not perfect but works.",
  'We built an internal tool to handle this but would much prefer a native solution.',
  "FYI - you can sort of do this with the API but it's pretty tedious.",

  // Thank yous and celebrations
  'Thanks for shipping this! Works great so far. 🚀',
  "Finally! We've been waiting for this. Thank you team! 🙏",
  'Just tried it out - exactly what we needed. Great work!',

  // Frustration (realistic but not aggressive)
  "Really hoping this gets prioritized soon. It's blocking our adoption.",
  'This has been open for a while now. Any chance of movement?',
  "Honestly surprised this isn't built-in already. Seems like a basic feature.",

  // Detailed responses
  'We have a similar need but slightly different use case:\n\n1. We need to export weekly\n2. It should include archived items\n3. PDF format preferred\n\nWould this cover our case?',
  "Adding some context on our use case: We're a marketing team and we need this for our quarterly reviews. Being able to share progress with stakeholders would be invaluable.",
]

// Team member comment content - responses from the product team
const teamCommentContent = [
  // Asking for more info
  'Thanks for the feedback! Could you share more details about your specific use case? That would help us prioritize this correctly.',
  "Appreciate you reporting this! Can you tell us what browser/device you're using? That would help us investigate.",
  'Great suggestion! Quick question - would you need this to work with the existing API, or would a standalone feature work for you?',

  // Providing updates
  "Quick update: We've started investigating this and it's looking promising. Will share more details soon!",
  "Just wanted to let you know we're actively looking into this. Thanks for your patience!",
  'Update: Our engineering team has picked this up. Expect to see progress in the next sprint.',

  // Helpful responses
  'In the meantime, you might be able to work around this by using our API. Happy to help if you need guidance!',
  "Pro tip: You can actually do something similar by using [feature X] - let me know if you'd like more details!",
  'Thanks for the detailed report! This is really helpful for our investigation.',

  // Acknowledgments
  "Great idea! We've added this to our backlog. Thanks for taking the time to share your thoughts.",
  'We hear you! This is definitely something we want to improve.',
  'Logged this with the team. Really appreciate the feedback!',
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

// Official team responses for posts that have been addressed
const officialResponses = [
  // Planned/Coming soon
  "Thanks for the suggestion! We've added this to our roadmap and plan to start work on it next quarter. Stay tuned for updates!",
  "Great idea! This is something we've been considering for a while. We're currently scoping out the work and will update this post once we have a timeline.",
  "We hear you! This feature is now on our roadmap. We'll keep you posted as we make progress.",
  "Thank you for the feedback! We've prioritized this feature and expect to start development soon.",

  // In progress
  "Exciting news - we've started working on this! Expect to see it in an upcoming release.",
  "This is currently in development! Our team is making good progress and we're targeting a release in the next few weeks.",
  "We're actively building this feature right now. Thanks for your patience - it's coming soon!",

  // Shipped/Complete
  '🎉 This feature is now live! Check out our latest release notes for details on how to use it.',
  'Good news - this has been shipped! Let us know how it works for your team.',
  "This is now available! We'd love to hear your feedback on the implementation.",
  'Shipped! Thanks for the great suggestion. This is now available for all users.',

  // Under review
  "Thanks for submitting this! We're currently reviewing the request and will update the status once we've made a decision.",
  "We're evaluating this request. Your use case is helpful for understanding the priority.",
  "Appreciate the detailed feedback! Our product team is reviewing this and we'll share our decision soon.",

  // Closed/Won't do (polite)
  "After careful consideration, we've decided not to pursue this feature at this time. It doesn't align with our current product direction, but we appreciate you sharing the idea!",
  "Thanks for the suggestion! While we won't be implementing this as described, we're exploring alternative solutions that might address your underlying need.",
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

// Curated user personas for realistic variety
const userPersonas = [
  // Power users - active commenters and voters
  { firstName: 'Sarah', lastName: 'Chen', role: 'Product Manager' },
  { firstName: 'Marcus', lastName: 'Johnson', role: 'Engineering Lead' },
  { firstName: 'Emily', lastName: 'Rodriguez', role: 'UX Designer' },
  { firstName: 'David', lastName: 'Kim', role: 'Founder' },
  { firstName: 'Rachel', lastName: 'Thompson', role: 'Head of Product' },
  // Regular users
  { firstName: 'Alex', lastName: 'Martinez', role: 'Developer' },
  { firstName: 'Jordan', lastName: 'Lee', role: 'Customer Success' },
  { firstName: 'Taylor', lastName: 'Wilson', role: 'Marketing Manager' },
  { firstName: 'Casey', lastName: 'Brown', role: 'Operations' },
  { firstName: 'Morgan', lastName: 'Davis', role: 'Sales Lead' },
  // Occasional users
  { firstName: 'Jamie', lastName: 'Garcia', role: 'Designer' },
  { firstName: 'Riley', lastName: 'Anderson', role: 'QA Engineer' },
  { firstName: 'Quinn', lastName: 'Taylor', role: 'DevOps' },
  { firstName: 'Avery', lastName: 'Moore', role: 'Support Lead' },
  { firstName: 'Blake', lastName: 'Jackson', role: 'Data Analyst' },
]

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

  // Pre-hash the demo password (used for all seeded accounts)
  const hashedPassword = hashPassword(DEMO_USER.password)

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
    password: hashedPassword,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  userRecords.push({ id: demoUserId, name: DEMO_USER.name, email: DEMO_USER.email })

  // Create users from personas (realistic names) plus some random ones
  for (let i = 0; i < CONFIG.users; i++) {
    const userId = uuid()
    let firstName: string
    let lastName: string

    // Use personas for first batch, then faker for remaining
    if (i < userPersonas.length) {
      firstName = userPersonas[i].firstName
      lastName = userPersonas[i].lastName
    } else {
      firstName = faker.person.firstName()
      lastName = faker.person.lastName()
    }

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
        password: hashedPassword, // Same password for testing
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

  // Create additional orgs with realistic but fictional company names
  const additionalOrgs = [
    { name: 'Nexaflow', slug: 'nexaflow' },
    { name: 'Brightpath Labs', slug: 'brightpath' },
  ]

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

        // Add official response to posts that aren't "open" (70% chance)
        const hasOfficialResponse =
          status !== 'open' && faker.datatype.boolean({ probability: 0.7 })
        const responder = hasOfficialResponse ? pick(orgMembers) : null

        // voteCount will be updated after votes are created
        await db.insert(posts).values({
          id: postId,
          boardId: board.id,
          title: pick(feedbackTitles),
          content: pick(feedbackContent),
          authorId: isAnonymous ? null : author.id,
          authorName: isAnonymous ? 'Anonymous' : author.name,
          authorEmail: isAnonymous ? null : author.email,
          status,
          voteCount: 0,
          ownerId: faker.datatype.boolean({ probability: 0.4 }) ? pick(orgMembers).id : null,
          estimated: faker.datatype.boolean({ probability: 0.3 })
            ? pick(['small', 'medium', 'large'])
            : null,
          officialResponse: hasOfficialResponse ? pick(officialResponses) : null,
          officialResponseAuthorId: responder?.id ?? null,
          officialResponseAuthorName: responder?.name ?? null,
          officialResponseAt: hasOfficialResponse ? randomDate(30) : null,
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
  let teamComments = 0

  for (const post of postRecords) {
    const commentCount = randomInt(CONFIG.commentsPerPost.min, CONFIG.commentsPerPost.max)
    const relevantUsers = userRecords.filter(() => faker.datatype.boolean({ probability: 0.5 }))

    for (let i = 0; i < commentCount; i++) {
      const author = pick(relevantUsers.length > 0 ? relevantUsers : userRecords)
      const isAnonymous = faker.datatype.boolean({ probability: 0.2 })

      // 15% chance of being a team member comment
      const isTeamMember = faker.datatype.boolean({ probability: 0.15 })

      await db.insert(comments).values({
        id: uuid(),
        postId: post.id,
        authorId: isAnonymous ? null : author.id,
        authorName: isAnonymous ? faker.person.fullName() : author.name,
        authorEmail: isAnonymous ? faker.internet.email().toLowerCase() : author.email,
        content: isTeamMember ? pick(teamCommentContent) : pick(commentContent),
        isTeamMember,
        createdAt: randomDate(60),
      })

      totalComments++
      if (isTeamMember) teamComments++
    }
  }

  console.log(`   Created ${totalComments} comments (${teamComments} from team members)`)

  // =========================================================================
  // Create Votes
  // =========================================================================
  console.log('👍 Creating votes...')

  let totalVotes = 0
  const postVoteCounts: Map<string, number> = new Map()

  for (const post of postRecords) {
    // Variable number of voters per post (0-30 with weighted distribution)
    const voterCount = randomInt(CONFIG.votesPerPost.min, CONFIG.votesPerPost.max)
    const voters = pickMultiple(userRecords, Math.min(voterCount, userRecords.length))
    let postVotes = 0

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

      postVotes++
      totalVotes++
    }

    postVoteCounts.set(post.id, postVotes)
  }

  // Update vote counts on posts to match actual votes
  for (const [postId, voteCount] of postVoteCounts) {
    await db.update(posts).set({ voteCount }).where(eq(posts.id, postId))
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
