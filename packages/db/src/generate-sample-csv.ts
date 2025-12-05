#!/usr/bin/env bun
/**
 * Bulk sample data generator for CSV import.
 *
 * Generates realistic feedback posts with power-law distributions
 * similar to UserVoice, Canny, and other feedback platforms.
 *
 * Usage:
 *   bun run db:generate-csv [count] [output]
 *
 * Examples:
 *   bun run db:generate-csv                     # 100 rows to stdout
 *   bun run db:generate-csv 10000               # 10k rows to stdout
 *   bun run db:generate-csv 10000 sample.csv    # 10k rows to file
 *
 * Note: This generates vote_count values only (no actual vote/comment records).
 * Use the UI import feature to import the CSV into a board.
 */

import { faker } from '@faker-js/faker'

// Configuration
const DEFAULT_COUNT = 100
const MAX_COUNT = 10000

// Parse arguments
const args = process.argv.slice(2)
const count = Math.min(parseInt(args[0]) || DEFAULT_COUNT, MAX_COUNT)
const outputFile = args[1]

// ============================================================================
// Realistic feedback content (curated from common SaaS feature requests)
// ============================================================================

const feedbackTitles = [
  // Integrations (very commonly requested)
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
  'Zendesk integration',
  'Asana integration',
  'Monday.com integration',

  // Export/Import
  'Export to CSV',
  'Export to PDF reports',
  'Bulk import from spreadsheet',
  'Export data to JSON',
  'Import from Trello',
  'Import from Canny',
  'Weekly digest email export',
  'Automated backups',

  // UI/UX (high engagement topics)
  'Dark mode support',
  'Mobile app for iOS',
  'Mobile app for Android',
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
  'Multi-language support',
  'Offline mode',

  // Core Features
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
  'Nested comments',
  'Rich text editor',
  'File attachments',
  'Image uploads',
  'Video embeds',

  // API/Developer
  'Public API access',
  'Webhooks for events',
  'SSO/SAML support',
  'API rate limit increase',
  'GraphQL API',
  'Embeddable widget',
  'White-label option',
  'Custom domain support',
  'API documentation improvements',
  'SDK for popular languages',

  // Team/Collaboration
  'Assign posts to team members',
  'Internal notes on posts',
  'Team activity log',
  'Role-based permissions',
  'Approval workflow',
  'Comment mentions (@user)',
  'Team inbox',
  'Customer segments',
  'User groups',
  'Shared views',

  // Analytics
  'Analytics dashboard',
  'Vote trends over time',
  'User engagement metrics',
  'Export analytics data',
  'Custom reports',
  'NPS score tracking',
  'Feature adoption tracking',
  'Customer health scores',

  // Bugs (lower engagement, more urgent)
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
  'Session timeout too aggressive',
  'Duplicate email notifications',
  'Broken links in emails',
  'Data not syncing properly',
  'UI freezes on large datasets',
]

const feedbackContent = [
  // Short and direct (common)
  'Would love to see this added! It would save us so much time.',
  'This is a must-have for our team. We currently have to use a separate tool for this.',
  'Please prioritize this! Many of us have been asking for this feature.',
  "Is this on the roadmap? We'd really benefit from this functionality.",
  '+1 from our team. This would be a game-changer for our workflow.',
  'Really need this for our workflow.',
  'This would be incredibly helpful.',
  'Any updates on this? Still waiting!',
  'Bumping this request - still very much needed.',
  'Our team would love this feature.',

  // Detailed use case
  "We're a team of 15 and we use the product daily. This feature would help us streamline our process significantly. Right now we have to export data manually and it takes about 2 hours per week.",
  "As a product manager, I need this to better communicate with stakeholders. Currently I'm taking screenshots and pasting them into slides which is not ideal.",
  'Our customers keep asking us about this. Would be great to have it built-in rather than pointing them to third-party solutions.',
  "We evaluated several tools before choosing yours, and this was the one feature we were hoping you'd add. It's not a dealbreaker but would definitely make our lives easier.",
  "We're migrating from another tool and this is the main blocker for us. Would make the transition so much smoother.",

  // Problem-focused
  'The current workaround is pretty tedious. I have to:\n1. Export the data\n2. Open it in Excel\n3. Reformat everything\n4. Import it into the other system\n\nA direct integration would eliminate all of this.',
  "We've tried using the API for this but it's not quite flexible enough. A native solution would be much better.",
  'This has been a pain point for us since we started using the platform. Would really appreciate seeing this addressed.',
  'Without this, we spend about 3 hours a week on manual workarounds. Please consider adding!',

  // With context
  'Coming from Notion, this is the one thing I miss. Would make the transition complete for our team.',
  "We're a startup with limited resources, so anything that saves time is valuable. This would probably save us 5+ hours per week.",
  "I've talked to other users in the community and this seems to be a common request. Happy to help beta test if you need feedback!",
  'We recently switched from a competitor and this was available there. Really missing it now.',

  // Enthusiastic
  "This would be AMAZING! We've been hoping for this since we signed up.",
  'Yes please! Would happily pay extra for this feature.',
  'Been waiting for this! Would make the product 10x more useful for our use case.',
  'Take my money! This is exactly what we need.',
  'This is THE feature that would make me upgrade to the enterprise plan.',

  // Professional/enterprise
  'This is a requirement for our enterprise security team. Without it, we may need to evaluate alternatives.',
  "We're planning to roll this out to 500+ users but need this feature first. Happy to discuss our requirements in more detail.",
  'Our compliance team has flagged this as necessary for SOC 2. Can you share an ETA?',
  'Our legal team requires this for GDPR compliance. When can we expect it?',
  'We have a team of 200 waiting to onboard, but we need this first.',

  // Bug report style
  'Steps to reproduce:\n1. Go to the dashboard\n2. Click on the filter dropdown\n3. Select multiple options\n4. The page freezes\n\nThis happens consistently on Chrome and Firefox.',
  'This started happening after the last update. Was working fine before. Not sure if related but wanted to flag it.',
  'Seeing this issue intermittently. Happens maybe 1 in 5 times. Happy to provide more details or a screen recording if helpful.',
  'Browser: Chrome 120\nOS: macOS Sonoma\nSteps: Navigate to settings > integrations\nExpected: Page loads\nActual: Blank screen',

  // With alternatives considered
  'I know you can kind of do this with the API, but a native solution would be much more accessible for non-technical team members.',
  'We looked at building this ourselves using webhooks but it is quite complex. Would prefer an official solution.',
  "We've been using a third-party tool for this, but would prefer native support.",
]

// Tags with realistic frequency weights
const tagOptions = [
  { name: 'feature', weight: 35 },
  { name: 'bug', weight: 15 },
  { name: 'enhancement', weight: 20 },
  { name: 'ux', weight: 12 },
  { name: 'integration', weight: 10 },
  { name: 'mobile', weight: 6 },
  { name: 'api', weight: 5 },
  { name: 'performance', weight: 4 },
  { name: 'security', weight: 3 },
  { name: 'documentation', weight: 2 },
]

// Status with realistic distribution (most posts are open)
const statusWeights = {
  open: 45,
  under_review: 20,
  planned: 15,
  in_progress: 10,
  complete: 7,
  closed: 3,
}

// User personas for author variety
const userPersonas = [
  { firstName: 'Sarah', lastName: 'Chen' },
  { firstName: 'Marcus', lastName: 'Johnson' },
  { firstName: 'Emily', lastName: 'Rodriguez' },
  { firstName: 'David', lastName: 'Kim' },
  { firstName: 'Rachel', lastName: 'Thompson' },
  { firstName: 'Alex', lastName: 'Martinez' },
  { firstName: 'Jordan', lastName: 'Lee' },
  { firstName: 'Taylor', lastName: 'Wilson' },
  { firstName: 'Casey', lastName: 'Brown' },
  { firstName: 'Morgan', lastName: 'Davis' },
  { firstName: 'Jamie', lastName: 'Garcia' },
  { firstName: 'Riley', lastName: 'Anderson' },
  { firstName: 'Quinn', lastName: 'Taylor' },
  { firstName: 'Avery', lastName: 'Moore' },
  { firstName: 'Blake', lastName: 'Jackson' },
  { firstName: 'Chris', lastName: 'Miller' },
  { firstName: 'Sam', lastName: 'Williams' },
  { firstName: 'Pat', lastName: 'Brown' },
  { firstName: 'Drew', lastName: 'Smith' },
  { firstName: 'Reese', lastName: 'Clark' },
]

// ============================================================================
// Helpers
// ============================================================================

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function weightedPick<T>(items: { name: T; weight: number }[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let random = Math.random() * total
  for (const item of items) {
    random -= item.weight
    if (random <= 0) return item.name
  }
  return items[0].name
}

function pickWeightedTags(max: number): string[] {
  const count = Math.floor(Math.random() * (max + 1))
  const selected: string[] = []
  const available = [...tagOptions]

  for (let i = 0; i < count && available.length > 0; i++) {
    const tag = weightedPick(available)
    selected.push(tag)
    const index = available.findIndex((t) => t.name === tag)
    if (index !== -1) available.splice(index, 1)
  }

  return selected
}

function weightedStatus(): string {
  const total = Object.values(statusWeights).reduce((a, b) => a + b, 0)
  let random = Math.random() * total
  for (const [status, weight] of Object.entries(statusWeights)) {
    random -= weight
    if (random <= 0) return status
  }
  return 'open'
}

/**
 * Generate vote count with realistic distribution.
 * Based on typical feedback platform patterns:
 * - 60% of posts: 0-5 votes (low engagement)
 * - 25% of posts: 5-25 votes (moderate)
 * - 10% of posts: 25-100 votes (popular)
 * - 4% of posts: 100-500 votes (very popular)
 * - 1% of posts: 500+ votes (viral)
 */
function generateVoteCount(): number {
  const roll = Math.random()

  if (roll < 0.6) {
    // Low engagement: 0-5 votes
    return Math.floor(Math.random() * 6)
  } else if (roll < 0.85) {
    // Moderate: 5-25 votes
    return 5 + Math.floor(Math.random() * 21)
  } else if (roll < 0.95) {
    // Popular: 25-100 votes
    return 25 + Math.floor(Math.random() * 76)
  } else if (roll < 0.99) {
    // Very popular: 100-500 votes
    return 100 + Math.floor(Math.random() * 401)
  } else {
    // Viral: 500-2000 votes
    return 500 + Math.floor(Math.random() * 1501)
  }
}

function randomDate(daysAgo: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - Math.floor(Math.random() * daysAgo))
  date.setHours(
    Math.floor(Math.random() * 24),
    Math.floor(Math.random() * 60),
    Math.floor(Math.random() * 60)
  )
  return date
}

function escapeCSV(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// ============================================================================
// Row Generation
// ============================================================================

function generateRow(): string[] {
  // Author: 75% have author, 25% anonymous
  const hasAuthor = Math.random() > 0.25
  let authorName = ''
  let authorEmail = ''

  if (hasAuthor) {
    if (Math.random() < 0.6) {
      const persona = pick(userPersonas)
      authorName = `${persona.firstName} ${persona.lastName}`
      authorEmail = `${persona.firstName.toLowerCase()}.${persona.lastName.toLowerCase()}@example.com`
    } else {
      const firstName = faker.person.firstName()
      const lastName = faker.person.lastName()
      authorName = `${firstName} ${lastName}`
      authorEmail = faker.internet.email({ firstName, lastName }).toLowerCase()
    }
  }

  // Tags: 0-3 with weighted selection
  const tags = pickWeightedTags(3).join(',')

  // Vote count with power-law distribution
  const voteCount = generateVoteCount()

  // Created date: spread over 365 days with recency bias
  const daysAgo = Math.floor(Math.pow(Math.random(), 2) * 365) // Quadratic = more recent posts
  const createdAt = randomDate(daysAgo).toISOString()

  return [
    pick(feedbackTitles),
    pick(feedbackContent),
    weightedStatus(),
    tags,
    '', // board
    authorName,
    authorEmail,
    voteCount.toString(),
    createdAt,
  ]
}

// ============================================================================
// CSV Generation
// ============================================================================

function generateCSV(rowCount: number): string {
  const headers = [
    'title',
    'content',
    'status',
    'tags',
    'board',
    'author_name',
    'author_email',
    'vote_count',
    'created_at',
  ]
  const lines = [headers.join(',')]

  for (let i = 0; i < rowCount; i++) {
    const row = generateRow().map(escapeCSV)
    lines.push(row.join(','))
  }

  return lines.join('\n')
}

// ============================================================================
// Main
// ============================================================================

console.error(`Generating ${count} sample posts...`)

const csv = generateCSV(count)

if (outputFile) {
  await Bun.write(outputFile, csv)
  console.error(`✅ Generated ${count} rows to ${outputFile}`)

  // Print distribution stats
  const lines = csv.split('\n').slice(1) // Skip header
  const votes = lines.map((line) => {
    const parts = line.split(',')
    return parseInt(parts[parts.length - 2]) || 0
  })
  const sorted = votes.sort((a, b) => b - a)

  console.error('\nVote distribution:')
  console.error(`  Top 1%:    ${sorted[Math.floor(sorted.length * 0.01)]}+ votes`)
  console.error(`  Top 5%:    ${sorted[Math.floor(sorted.length * 0.05)]}+ votes`)
  console.error(`  Top 10%:   ${sorted[Math.floor(sorted.length * 0.1)]}+ votes`)
  console.error(`  Median:    ${sorted[Math.floor(sorted.length * 0.5)]} votes`)
  console.error(`  Bottom 50%: 0-${sorted[Math.floor(sorted.length * 0.5)]} votes`)
} else {
  console.log(csv)
}
