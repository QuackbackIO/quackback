/**
 * Made-up items Home's blocks draw in the builder alone, while designing, in
 * a block whose own data has nothing to show yet, so it can be seen and
 * styled. Each block that draws them says it is a sample. A visitor never
 * sees them: the live portal draws the block's message, or leaves it out.
 */

const DAY = 86_400_000

export const SAMPLE_POSTS = [
  { id: 'sample_post_1', title: 'Dark mode for the dashboard', voteCount: 48, commentCount: 12 },
  { id: 'sample_post_2', title: 'Export reports as a spreadsheet', voteCount: 31, commentCount: 7 },
  { id: 'sample_post_3', title: 'Sign in with a passkey', voteCount: 19, commentCount: 3 },
  { id: 'sample_post_4', title: 'Weekly email digest', voteCount: 12, commentCount: 2 },
  { id: 'sample_post_5', title: 'Keyboard shortcuts', voteCount: 9, commentCount: 1 },
]

export const SAMPLE_STATUS = { name: 'Planned', color: '#3b82f6' }

export const SAMPLE_COLUMNS = [
  { id: 'sample_column_1', name: 'Planned', color: '#3b82f6' },
  { id: 'sample_column_2', name: 'In progress', color: '#f59e0b' },
  { id: 'sample_column_3', name: 'Done', color: '#22c55e' },
]

export const sampleEntries = (now: number) => [
  {
    id: 'sample_entry_1',
    title: 'A faster search',
    publishedAt: new Date(now - 3 * DAY),
    content: 'Search now finds what you type as you type it, and remembers your recent searches.',
  },
  {
    id: 'sample_entry_2',
    title: 'Comments you can edit',
    publishedAt: new Date(now - 12 * DAY),
    content: 'Fix a typo or add a detail after you post, for up to a day.',
  },
  {
    id: 'sample_entry_3',
    title: 'A new mobile app',
    publishedAt: new Date(now - 30 * DAY),
    content: 'Vote and comment on the go, with notifications when something you follow ships.',
  },
  {
    id: 'sample_entry_4',
    title: 'Two-step sign in',
    publishedAt: new Date(now - 45 * DAY),
    content: 'Turn it on in your account settings for an extra layer of safety.',
  },
]

export const SAMPLE_TOPICS = [
  {
    id: 'sample_topic_1',
    name: 'Getting started',
    description: 'Set up your account and invite your team.',
    articleCount: 6,
    articles: ['Create your account', 'Invite your team', 'Your first project'],
  },
  {
    id: 'sample_topic_2',
    name: 'Billing',
    description: 'Plans, invoices and payment methods.',
    articleCount: 4,
    articles: ['Change your plan', 'Download an invoice', 'Update your card'],
  },
  {
    id: 'sample_topic_3',
    name: 'Integrations',
    description: 'Connect the tools you already use.',
    articleCount: 5,
    articles: ['Connect your chat app', 'Use the API', 'Set up webhooks'],
  },
]
