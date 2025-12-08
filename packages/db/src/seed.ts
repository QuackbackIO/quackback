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
import bcrypt from 'bcryptjs'
import { user, organization, member, account, workspaceDomain } from './schema/auth'
import { boards, tags, roadmaps } from './schema/boards'
import { posts, postTags, postRoadmaps } from './schema/posts'
import { postStatuses, DEFAULT_STATUSES } from './schema/statuses'

const connectionString = process.env.DATABASE_URL!
const client = postgres(connectionString)
const db = drizzle(client)

/**
 * Verify that migrations have been run and RLS is properly configured.
 * This checks for the app_user role and app_org_id function.
 */
async function verifyMigrationsApplied() {
  // Check if app_user role exists
  const roleCheck = await client`
    SELECT 1 FROM pg_roles WHERE rolname = 'app_user'
  `
  if (roleCheck.length === 0) {
    throw new Error(
      'Database migrations have not been applied.\n' +
        'Please run: bun run db:migrate\n' +
        'Then try seeding again.'
    )
  }

  // Check if app_org_id function exists
  const funcCheck = await client`
    SELECT 1 FROM pg_proc WHERE proname = 'app_org_id'
  `
  if (funcCheck.length === 0) {
    throw new Error(
      'Database migrations have not been applied.\n' +
        'Please run: bun run db:migrate\n' +
        'Then try seeding again.'
    )
  }

  // Check if RLS policies exist for key tables
  const policyCheck = await client`
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
    AND policyname IN ('boards_tenant_isolation', 'posts_tenant_isolation', 'comment_reactions_tenant_isolation')
  `
  if (policyCheck.length < 3) {
    throw new Error(
      'RLS policies are missing. Database migrations may not have been applied correctly.\n' +
        'Please run: bun run db:migrate\n' +
        'Then try seeding again.'
    )
  }
}

/**
 * Optimize database for bulk inserts.
 */
async function optimizeForBulkInsert() {
  await client.unsafe(`SET synchronous_commit = off`)
  await client.unsafe(`SET work_mem = '256MB'`)
}

/**
 * Reset database settings after bulk insert.
 */
async function resetDatabaseSettings() {
  await client.unsafe(`SET synchronous_commit = on`)
  await client.unsafe(`RESET work_mem`)
}

// Hash password using bcrypt (matches Better-Auth config)
function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10)
}

// Configuration - simulating a large enterprise
const CONFIG = {
  users: 500,
  boardsPerOrg: 10,
  totalPosts: 15000, // Total posts to generate (distributed across boards)
  batchSize: 1000, // Insert in batches (limited by PostgreSQL's 65535 param limit)
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
// Template variables for dynamic content
const TEMPLATE_VARS = {
  teamSize: ['5', '10', '15', '20', '25', '30', '50', '75', '100', '150', '200', '500', '1000'],
  department: [
    'Engineering',
    'Marketing',
    'Sales',
    'Customer Success',
    'Product',
    'Design',
    'Operations',
    'Finance',
    'HR',
    'Legal',
    'Support',
    'Data Science',
    'DevOps',
    'QA',
  ],
  competitor: [
    'Canny',
    'UserVoice',
    'Productboard',
    'Aha!',
    'Trello',
    'Asana',
    'Monday.com',
    'Notion',
    'Jira',
    'Linear',
  ],
  timeframe: [
    'this quarter',
    'next month',
    'by EOY',
    'in Q1',
    'in Q2',
    'before our launch',
    'ASAP',
    'within 30 days',
    'by next sprint',
  ],
  priority: [
    'critical',
    'high priority',
    'important',
    'blocking',
    'urgent',
    'a top priority',
    'essential',
  ],
  browser: [
    'Chrome',
    'Firefox',
    'Safari',
    'Edge',
    'Chrome on Mac',
    'Safari on iOS',
    'Chrome on Android',
    'Firefox on Windows',
  ],
  version: [
    'v2.1',
    'v2.0',
    'v1.9',
    'v1.8.5',
    'latest version',
    'previous version',
    'beta',
    'the recent update',
  ],
  frequency: [
    'every time',
    'intermittently',
    'about 50% of the time',
    'randomly',
    'consistently',
    'only sometimes',
    'frequently',
    'occasionally',
  ],
  hoursWasted: ['2', '3', '5', '8', '10', '15', '20'],
  percentageImpact: ['20%', '30%', '40%', '50%', '60%', '70%'],
}

// Categorized feedback titles for realistic pairing
type FeedbackCategory =
  | 'bug'
  | 'feature'
  | 'integration'
  | 'ux'
  | 'performance'
  | 'security'
  | 'api'
  | 'mobile'

const categorizedTitles: Record<FeedbackCategory, string[]> = {
  integration: [
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
    'Figma integration for design feedback',
    'Google Sheets sync',
    'Airtable integration',
    'Mailchimp integration',
    'Stripe billing integration',
    'PagerDuty integration for incidents',
    'Datadog integration',
    'Segment integration',
    'Mixpanel event tracking',
    'Amplitude integration',
    'Confluence wiki sync',
    'SharePoint integration',
    'Dropbox file attachments',
    'Google Drive integration',
    'OneDrive integration',
    'Box integration',
    'Okta SSO integration',
    'Azure AD integration',
    'Auth0 integration',
    'OneLogin integration',
    'GitLab issue sync',
    'Bitbucket integration',
    'Asana task sync',
    'Monday.com integration',
    'ClickUp integration',
    'Basecamp integration',
    'Freshdesk integration',
  ],
  feature: [
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
    'Export to CSV',
    'Export to PDF reports',
    'Bulk import from spreadsheet',
    'Export data to JSON',
    'Import from Trello',
    'Import from Canny',
    'Weekly digest email export',
    'Assign posts to team members',
    'Internal notes on posts',
    'Team activity log',
    'Role-based permissions',
    'Approval workflow',
    'Comment mentions (@user)',
    'Team inbox',
    'Analytics dashboard',
    'Vote trends over time',
    'User engagement metrics',
    'Export analytics data',
    'Custom reports',
    'NPS score tracking',
    'Public API access',
    'Webhooks for events',
    'SSO/SAML support',
    'API rate limit increase',
    'GraphQL API',
    'Embeddable widget',
    'White-label option',
    'Multi-language support',
    'Custom email templates',
    'Automatic status updates',
    'User segmentation',
    'Feedback scoring system',
    'SLA tracking for responses',
    'Customer health scores',
    'Predictive analytics',
    'A/B testing for roadmaps',
    'Version history for posts',
    'Audit log for compliance',
    'Data retention policies',
    'GDPR compliance tools',
    'Custom domain support',
    'IP allowlisting',
    'Two-factor authentication',
    'Session management',
    'API key rotation',
    'Bulk user import',
    'User provisioning via SCIM',
    'Custom user roles',
    'Team hierarchies',
    'Department-based permissions',
    'Feedback routing rules',
    'Auto-tagging with AI',
    'Smart categorization',
    'Duplicate detection alerts',
    'Trending topics dashboard',
    'Customer journey mapping',
    'Impact scoring for features',
    'Revenue attribution',
    'Churn risk indicators',
    'Feature adoption tracking',
  ],
  ux: [
    'Dark mode support',
    'Keyboard shortcuts',
    'Customizable dashboard',
    'Drag and drop reordering',
    'Collapsible sidebar',
    'Full-screen mode',
    'Compact view option',
    'Card view vs list view toggle',
    'Custom themes',
    'Accessibility improvements',
    'RTL language support',
    'Improved navigation breadcrumbs',
    'Better empty states',
    'Onboarding tour improvements',
    'Simplified settings page',
    'Quick actions menu',
    'Global search improvements',
    'Better date picker',
    'Improved rich text editor',
    'Image preview in posts',
    'Inline editing for posts',
    'Bulk selection improvements',
    'Better loading states',
    'Skeleton screens instead of spinners',
    'Improved error messages',
    'Undo/redo functionality',
    'Autosave for drafts',
    'Better notification center',
    'Customizable home page',
    'Widget-based dashboard',
    'Resizable columns in tables',
    'Sticky headers in long lists',
    'Infinite scroll option',
    'Better pagination controls',
    'Improved mobile navigation',
    'Swipe gestures support',
    'Pull to refresh',
    'Better touch targets',
    'Improved form validation',
    'Real-time character count',
  ],
  bug: [
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
    'Comments not appearing after posting',
    'Vote count not updating in real-time',
    'Broken links in email notifications',
    'Avatar images not loading',
    'Export fails for large datasets',
    'Duplicate notifications being sent',
    'Session expires unexpectedly',
    'Filters reset after page refresh',
    'Sorting not working correctly',
    'Tags not saving on posts',
    'Rich text formatting lost on save',
    'File attachments disappearing',
    'Webhook deliveries failing silently',
    'API returning stale data',
    'Search indexing delayed',
    'Roadmap items in wrong order',
    'Status changes not triggering notifications',
    'User permissions not applying correctly',
    'Board settings not saving',
    'Custom fields showing wrong values',
    'Date picker showing wrong timezone',
    'Markdown rendering incorrectly',
    'Code blocks not syntax highlighted',
    'Mentions not linking to users',
    'Emoji picker not working',
    'Copy/paste strips formatting',
    'Undo not working in editor',
    'Auto-save causing data loss',
    'Concurrent edit conflicts',
    'Draft posts publishing prematurely',
    'Archived posts appearing in search',
    'Deleted comments still visible',
    'Vote button unresponsive',
    'Infinite loading spinner',
    'White screen after login',
    'Mobile menu not opening',
    'Keyboard navigation broken',
    'Screen reader not announcing changes',
    'Focus trap in modals broken',
    'Form submission without validation',
  ],
  performance: [
    'Dashboard takes too long to load',
    'Search is very slow with many posts',
    'Exporting large reports times out',
    'Page becomes unresponsive with many comments',
    'Initial page load is slow',
    'Images loading slowly',
    'API responses taking too long',
    'Real-time updates causing lag',
    'Memory usage grows over time',
    'Browser tab crashes with large boards',
    'Scrolling is janky on long lists',
    'Filtering causes UI freeze',
    'Bulk operations are too slow',
    'Webhook processing delays',
    'Email sending queue backing up',
    'Search suggestions lag behind typing',
    'Auto-complete is slow',
    'File uploads are slow',
    'Preview generation takes too long',
    'Report generation timing out',
    'Analytics queries are slow',
    'Dashboard widgets loading sequentially',
    'Lazy loading not working',
    'Cache not being utilized',
    'Too many database queries',
    'N+1 query issues',
    'Inefficient pagination',
    'Large payload sizes',
    'Unnecessary re-renders',
    'Bundle size too large',
  ],
  security: [
    'Add two-factor authentication',
    'Implement session timeout',
    'Add IP allowlisting',
    'Audit log for all actions',
    'Encrypt data at rest',
    'Add CAPTCHA to public forms',
    'Implement rate limiting',
    'Add brute force protection',
    'Security headers missing',
    'CORS policy too permissive',
    'Sensitive data in URL parameters',
    'Session tokens in local storage',
    'Missing input sanitization',
    'XSS vulnerability in comments',
    'CSRF protection needed',
    'SQL injection risk',
    'File upload validation weak',
    'Password policy too lenient',
    'Account lockout not working',
    "Password reset token doesn't expire",
    'API keys visible in logs',
    'Secrets in client-side code',
    'Missing Content Security Policy',
    'Insecure direct object references',
    'Broken access control',
    'Missing encryption in transit',
    'Weak cipher suites',
    'Certificate pinning needed',
    'Penetration test findings',
    'SOC 2 compliance gaps',
  ],
  api: [
    'REST API rate limits too low',
    'Need GraphQL support',
    'API documentation incomplete',
    'Webhook retry logic needed',
    'API versioning strategy unclear',
    'Need bulk API endpoints',
    'API authentication options limited',
    'Missing API pagination',
    'Need API sandbox environment',
    'API error messages not helpful',
    'SDK for Python needed',
    'SDK for JavaScript needed',
    'SDK for Ruby needed',
    'SDK for Go needed',
    'API response times inconsistent',
    'Need streaming API',
    'Webhook signature verification',
    'API changelog needed',
    'Need OpenAPI/Swagger spec',
    'API deprecation notices needed',
    'Need API usage analytics',
    'API quotas not visible',
    'Need batch operations API',
    'Real-time events via WebSocket',
    'API key scoping needed',
    'Need read-only API keys',
    'API caching headers missing',
    'Need conditional requests support',
    'Expand/include params needed',
    'Field filtering in responses',
  ],
  mobile: [
    'Native iOS app needed',
    'Native Android app needed',
    'Push notifications for mobile',
    'Offline mode for mobile',
    'Mobile app keeps logging out',
    'Touch ID / Face ID support',
    'Mobile app crashes on startup',
    'Deep linking not working',
    'Mobile app battery drain',
    'Mobile app uses too much data',
    'Camera integration for attachments',
    'Voice input for feedback',
    'Mobile widget for quick feedback',
    'Apple Watch companion app',
    'Android widget support',
    'Mobile app dark mode',
    'Haptic feedback on actions',
    'Mobile-specific gestures',
    'Share sheet integration',
    'Mobile app size too large',
    'Mobile app slow on older devices',
    'Tablet-optimized layout needed',
    'Split view support on iPad',
    'Mobile app localization',
    'Mobile accessibility improvements',
    'Mobile keyboard shortcuts',
    'Quick reply from notification',
    'Mobile biometric login',
    'Mobile app auto-update',
    'Mobile beta testing program',
  ],
}

// Category-specific content templates with dynamic variables
const categorizedContent: Record<FeedbackCategory, string[]> = {
  bug: [
    `Steps to reproduce:\n1. Go to the affected page\n2. Perform the action\n3. Observe the error\n\nThis happens {frequency} on {browser}.`,
    `This started happening after {version}. Was working fine before. Not sure if related but wanted to flag it.`,
    `Seeing this issue {frequency}. Happy to provide more details or a screen recording if helpful.`,
    `Our {department} team reported this. It's affecting {teamSize}+ users and is {priority} for us.`,
    `Bug appears {frequency}. Browser: {browser}. We've tried clearing cache and cookies but issue persists.`,
    `This is blocking our {department} team. They can't complete their work until this is resolved.`,
    `We first noticed this issue after updating to {version}. Rolling back temporarily fixed it.`,
    `Multiple users across our {department} department are experiencing this. It's become {priority}.`,
    `Error occurs {frequency} when using {browser}. Console shows JavaScript errors.`,
    `This bug is causing data inconsistencies for our team of {teamSize}. Please prioritize!`,
    `Reproducible 100% of the time on {browser}. Have tried on multiple machines.`,
    `Our QA team identified this in {version}. It's a regression from the previous release.`,
    `The issue seems to be related to our setup with {teamSize} users. Smaller accounts may not see it.`,
    `We've lost {hoursWasted} hours of work due to this bug. Need an urgent fix.`,
    `This is impacting {percentageImpact} of our daily workflows. Critical issue for our {department} team.`,
    `Happens every time we try to use this feature. {browser} on both Mac and Windows.`,
    `Our {department} lead flagged this as {priority}. It's affecting customer demos.`,
    `Since {version}, this has been broken. We need this fixed {timeframe}.`,
    `Error message isn't helpful. Just says "Something went wrong." Need better error handling.`,
    `This used to work in {version}. Now it fails {frequency}. No changes on our end.`,
  ],
  feature: [
    `Would love to see this added! Our {department} team would save {hoursWasted}+ hours per week.`,
    `This is a must-have for our team of {teamSize}. We currently have to use a separate tool for this.`,
    `Please prioritize this {timeframe}! Many of us have been asking for this feature.`,
    `Is this on the roadmap? We'd really benefit from this functionality in our {department} workflows.`,
    `+1 from our {department} team. This would be a game-changer for our workflow.`,
    `We're a team of {teamSize} and we use the product daily. This feature would help us streamline our process significantly.`,
    `As a {department} lead, I need this to better communicate with stakeholders. Currently our workaround takes {hoursWasted} hours weekly.`,
    `Our customers keep asking us about this. Would be great to have it built-in rather than pointing them to third-party solutions.`,
    `We evaluated {competitor} before choosing you, and this was the one feature we were hoping you'd add.`,
    `The current workaround is pretty tedious for our {teamSize} person team. A native solution would save us {hoursWasted} hours per week.`,
    `We've tried using the API for this but it's not flexible enough for our {department} team's needs.`,
    `This has been a pain point since we started using the platform. Our {department} team would really appreciate this.`,
    `Coming from {competitor}, this is the one thing I miss. Would make the transition complete for our team.`,
    `We're planning to roll this out to {teamSize}+ users but need this feature first. Happy to discuss our requirements.`,
    `Our compliance team has flagged this as necessary. Can you share an ETA? We need this {timeframe}.`,
    `This would be AMAZING for our {department} team! We've been hoping for this since we signed up.`,
    `Would happily pay extra for this feature. It's {priority} for our organization.`,
    `Been waiting for this! Would make the product significantly more useful for our {teamSize} person {department} team.`,
    `This is {priority} for our enterprise team. Without it, we may need to evaluate alternatives like {competitor}.`,
    `I've talked to other users in the community and this seems to be a common request. Our {department} team needs this {timeframe}.`,
    `We need this for our {department} department's quarterly planning. Would impact {teamSize}+ people.`,
    `Currently using {competitor} just for this functionality. Would love to consolidate into your platform.`,
    `Our {department} team spends {hoursWasted} hours per week on manual workarounds. This feature would eliminate that.`,
    `This is blocking our expansion plans. We can't onboard more users without this capability.`,
    `Feature request from our {department} leadership. They've marked it as {priority} for {timeframe}.`,
  ],
  integration: [
    `We use this tool extensively in our {department} team. Native integration would save us {hoursWasted}+ hours weekly.`,
    `Currently using Zapier as a workaround but it's not reliable enough for our {teamSize} person team.`,
    `This integration is {priority} for our workflow. Our {department} team relies on this tool daily.`,
    `We're already paying for both tools. A direct integration would streamline our {department} processes significantly.`,
    `Our {department} team needs this integration {timeframe}. It's blocking several initiatives.`,
    `Switched from {competitor} and this was the one integration we miss. Please add support!`,
    `This would complete our tool stack. Currently have to manually sync data which wastes {hoursWasted} hours per week.`,
    `Our {teamSize} person team uses this tool for all {department} work. Integration would be transformative.`,
    `We've built a custom integration but it's fragile. Would much prefer an official, supported solution.`,
    `This is the most requested integration from our {department} team. They ask about it weekly.`,
    `Need bidirectional sync between the tools. One-way isn't sufficient for our {department} workflows.`,
    `Our {department} team lead has made this a requirement. We need it working {timeframe}.`,
    `Currently exporting/importing manually between the tools. Takes {hoursWasted} hours weekly for our team.`,
    `This integration would let us retire our hacky workaround and save the company money.`,
    `We're evaluating whether to continue with your platform. This integration is {priority} for our decision.`,
    `Need OAuth-based integration, not just API keys. Our {department} team needs SSO support.`,
    `Real-time sync needed, not just periodic. Our {teamSize} person team needs instant updates.`,
    `This would automate {percentageImpact} of our {department} team's manual work.`,
    `Integration with proper error handling and retry logic please. Our current Zapier setup fails silently.`,
    `We have {teamSize} users who would benefit immediately from this integration.`,
  ],
  ux: [
    `Our {department} team finds the current UI confusing. This improvement would help significantly.`,
    `This would make the product much more accessible for our less technical {department} team members.`,
    `We have users with accessibility needs. This improvement is {priority} for our {teamSize} person team.`,
    `The current design requires too many clicks for common actions. Our {department} team is frustrated.`,
    `Coming from {competitor}, this UX pattern is something we really miss.`,
    `Our {department} team spends extra time because of this UX issue. Would save {hoursWasted} hours weekly.`,
    `This is causing confusion for new users on our {teamSize} person team. Better UX would reduce training time.`,
    `Mobile experience is lacking for our {department} team who work remotely.`,
    `Keyboard shortcuts would dramatically speed up our power users in {department}.`,
    `The current workflow requires context switching. A streamlined UX would help our {teamSize} users.`,
    `Our {department} team has complained about this repeatedly. It's affecting adoption.`,
    `This UX improvement would make onboarding new team members much easier.`,
    `Dark mode is {priority} for our {department} team who work late hours.`,
    `The current interface doesn't scale well for our {teamSize} user deployment.`,
    `Accessibility audit flagged this as an issue. We need WCAG compliance {timeframe}.`,
    `Our {department} team prefers the {competitor} approach to this. Consider similar UX?`,
    `This small UX change would have a big impact on daily productivity.`,
    `The learning curve is too steep. Our new {department} hires struggle with this.`,
    `Customization options would let different teams configure the UI for their needs.`,
    `Touch-friendly design needed for our {department} team using tablets in the field.`,
  ],
  performance: [
    `With our {teamSize} users, the dashboard takes forever to load. Need optimization.`,
    `Search becomes unusable after we hit a certain number of posts. Our {department} team is frustrated.`,
    `Page load times have increased significantly since {version}. Was much faster before.`,
    `Our {department} team reports the app becomes unresponsive during peak usage hours.`,
    `Export functionality times out for our data volume. We have {teamSize} users generating content.`,
    `Initial load is okay but the app gets slower throughout the day. Memory leak perhaps?`,
    `API responses are taking 5+ seconds for our {teamSize} user account. This is impacting our {department} team.`,
    `Real-time updates are causing significant lag. Our {department} team has disabled them.`,
    `The app crashes the browser tab when viewing large boards. Happens {frequency} for our team.`,
    `Scrolling performance is poor on lists with many items. Virtualization would help.`,
    `Our {department} team can't use filtering effectively because it freezes the UI.`,
    `Bulk operations are so slow they're practically unusable for our {teamSize} user account.`,
    `The mobile experience is particularly slow. Our {department} field team struggles.`,
    `We're seeing N+1 query patterns in the API responses. Affecting our integrations.`,
    `Page size has grown significantly. Bundle optimization would help our slower connections.`,
    `Caching seems ineffective. Same requests taking same time on repeat visits.`,
    `Our {department} team in offices with slower internet can't use the product effectively.`,
    `Performance has degraded {percentageImpact} since we scaled to {teamSize} users.`,
    `The analytics dashboard is especially slow. Takes {hoursWasted}+ seconds to load.`,
    `Concurrent users cause significant slowdown. We have {teamSize} people online simultaneously.`,
  ],
  security: [
    `Our security team requires this for compliance. It's {priority} and needed {timeframe}.`,
    `This is blocking our enterprise deployment. We have {teamSize} users waiting.`,
    `Our {department} team handles sensitive data. This security feature is essential.`,
    `Compliance audit flagged this as a requirement. We need it addressed {timeframe}.`,
    `We can't pass our SOC 2 audit without this. It's {priority} for our organization.`,
    `Our CISO has made this a requirement before we can expand usage to {teamSize}+ users.`,
    `This security gap was identified in our vendor assessment. Please address {timeframe}.`,
    `Our {department} team can't use the platform until this is implemented. Compliance issue.`,
    `Enterprise customers are asking about this. It's becoming a sales blocker.`,
    `Our security team found this in their review. They've classified it as {priority}.`,
    `GDPR/CCPA compliance requires this capability. We need it {timeframe}.`,
    `Our penetration testing identified this as a vulnerability. Please patch.`,
    `This is standard for enterprise tools. Surprised it's not already implemented.`,
    `Our {department} team handles PII. This security feature is non-negotiable.`,
    `Insurance requirements mandate this security control. We need documentation too.`,
    `Our security questionnaire for prospects requires this. It's blocking {teamSize} potential users.`,
    `This aligns with NIST framework requirements. Our {department} team needs it.`,
    `Zero-trust architecture requires this capability. Please prioritize.`,
    `Our SIEM integration needs this feature for proper security monitoring.`,
    `Audit trail is incomplete without this. Our compliance team flagged it as {priority}.`,
  ],
  api: [
    `Our {department} team needs API access for custom integrations. Currently blocked.`,
    `Rate limits are too restrictive for our {teamSize} user account. Need higher limits.`,
    `API documentation is lacking. Our {department} developers are struggling.`,
    `We need webhooks for real-time updates. Polling isn't sufficient for our use case.`,
    `GraphQL would be much better for our {department} team's needs. REST is limiting.`,
    `Our developers need a sandbox environment to test integrations safely.`,
    `API versioning is unclear. We've had breaking changes affect our {department} team.`,
    `Need bulk endpoints for our {teamSize} user deployment. Individual calls are too slow.`,
    `SDK would accelerate our integration work. Our {department} developers would appreciate it.`,
    `API error messages aren't helpful. Our {department} team wastes time debugging.`,
    `We need read-only API keys for certain integrations. Security requirement.`,
    `Webhook retries would prevent data loss. We've missed events due to temporary outages.`,
    `API pagination is inconsistent across endpoints. Please standardize.`,
    `Need OpenAPI spec for code generation. Would speed up our {department} development.`,
    `API authentication options are limited. We need OAuth2 for our enterprise setup.`,
    `Our {department} team needs streaming support for real-time dashboards.`,
    `API quotas should be visible in the dashboard. We keep hitting limits unexpectedly.`,
    `Conditional requests would reduce our API usage significantly.`,
    `Field filtering would optimize our payloads. Currently getting too much data.`,
    `API changelog would help us prepare for changes. We've been surprised by updates.`,
  ],
  mobile: [
    `Our {department} field team needs mobile access. Currently limited to desktop.`,
    `Native app would be much better than the mobile web experience.`,
    `Push notifications are essential for our {department} team's workflow.`,
    `Offline mode needed for our team working in areas with poor connectivity.`,
    `Mobile app keeps logging out our {department} users. Very frustrating.`,
    `Touch ID/Face ID would speed up access for our {teamSize} mobile users.`,
    `Mobile app crashes frequently for our {department} team. Needs stability work.`,
    `Deep linking would integrate better with our other mobile tools.`,
    `Battery drain is significant. Our {department} team's phones don't last the day.`,
    `Mobile app uses too much data. Problematic for our team with limited plans.`,
    `Camera integration for attachments would help our {department} field team.`,
    `Voice input would be faster for quick feedback while on the go.`,
    `Widget would let our team submit feedback without opening the app.`,
    `Tablet layout is needed for our {department} team using iPads.`,
    `Mobile dark mode would match our other apps. {priority} for our users.`,
    `Our {department} team needs mobile-specific gestures for efficiency.`,
    `Share sheet integration would streamline our workflow significantly.`,
    `App size is too large. Some {department} team members can't install it.`,
    `Performance on older phones is poor. Not everyone has the latest device.`,
    `Quick reply from notification would save our team significant time.`,
  ],
}

// Generic content that can be used for any category (adds variety)
const genericContent = [
  `Would love to see this addressed! Our {department} team would benefit greatly.`,
  `This is {priority} for our team of {teamSize}. Please consider prioritizing.`,
  `We need this {timeframe}. It's affecting our {department} team's productivity.`,
  `+1 from our organization. This would improve things for {teamSize}+ users.`,
  `Our {department} team has been asking about this for months. Any update?`,
  `This would save us {hoursWasted} hours per week. Currently using manual workarounds.`,
  `Came from {competitor} and this was something we had there. Miss this feature.`,
  `This is blocking our expansion. We can't scale to {teamSize} users without this.`,
  `Our {department} leadership has flagged this as {priority}. Need resolution {timeframe}.`,
  `Would this be on the roadmap? Our team of {teamSize} is waiting for this.`,
]

// Template filling function
function fillTemplate(template: string): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const values = TEMPLATE_VARS[key as keyof typeof TEMPLATE_VARS]
    return values ? pick(values) : `{${key}}`
  })
}

// Get a random category with weighted distribution
function getRandomCategory(): FeedbackCategory {
  const weights: Record<FeedbackCategory, number> = {
    feature: 35, // Most common
    bug: 25, // Second most common
    integration: 12,
    ux: 10,
    performance: 6,
    security: 5,
    api: 4,
    mobile: 3,
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  let random = Math.random() * total
  for (const [category, weight] of Object.entries(weights)) {
    random -= weight
    if (random <= 0) return category as FeedbackCategory
  }
  return 'feature'
}

// Get title and content for a category, with template filling
function getCategorizedPostContent(category: FeedbackCategory): { title: string; content: string } {
  const title = pick(categorizedTitles[category])
  // 80% chance of category-specific content, 20% generic
  const contentPool = faker.datatype.boolean({ probability: 0.8 })
    ? categorizedContent[category]
    : genericContent
  const content = fillTemplate(pick(contentPool))
  return { title, content }
}

// Realistic comment content with templates - varied tones
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
  'This! 100%',
  'Exactly what we need',
  "Can't believe this isn't a thing yet",
  'Please!',
  'Yes! 🙏',
  'Adding my vote',

  // Agreements with context (templated)
  'This would be huge for our {department} team.',
  "We need this too. Currently using a hacky workaround that's not ideal.",
  'Agreed! This is one of the most requested features in our org.',
  'We switched from {competitor} specifically hoping you had this. Please prioritize!',
  "Adding my vote. We've got about {teamSize} users who would benefit from this.",
  'Our {department} team has been asking for this for months.',
  'This is {priority} for our organization. Please consider.',
  "We're blocked on this for our {timeframe} goals.",
  'Same situation here. Our {department} team is struggling without this.',
  '+1 from our {teamSize} person team. This would save us {hoursWasted} hours weekly.',
  'Our {department} lead just asked about this yesterday. Definitely needed.',
  'We evaluated {competitor} partially because they have this. Would love to see it here.',
  'This aligns perfectly with what our {department} team needs.',
  'Critical for our enterprise deployment of {teamSize}+ users.',

  // Questions
  'Any ETA on this?',
  'Is this being worked on? Would love an update.',
  "Curious if there's a workaround in the meantime?",
  'Would this work with the existing API or require changes?',
  'Has anyone found a third-party solution for this?',
  "What's the timeline looking like for this?",
  'Is this on the roadmap for {timeframe}?',
  'Can we get a status update? Our {department} team is waiting.',
  'Has anyone from the team commented on this?',
  'Is there a beta we can join to test this early?',
  'Would this be included in the enterprise plan?',
  'Any workarounds our {department} team could use meanwhile?',
  'Is this related to the other request about similar functionality?',
  'What would it take to prioritize this?',

  // Status check-ins
  "@team - any update on this? It's been a few months.",
  'Just checking in on this one. Still {priority} for us.',
  'Noticed this moved to "Under Review" - exciting! 🎉',
  'Saw this is now "Planned" - thank you for listening! ❤️',
  'Any movement on this? Our {department} team keeps asking.',
  'Checking back in - this is still {priority} for our team.',
  "It's been a while since the last update. Any news?",
  'Our {department} team is asking for an update on this.',
  'Still waiting on this one. Hope to see progress soon!',
  'Is this still being considered? No updates in a while.',

  // Constructive feedback
  'Great idea! One addition - it would be nice if it also supported bulk operations.',
  "Love this suggestion. For our use case, we'd also need it to handle edge cases.",
  'If you implement this, please make it optional/configurable.',
  'Would be great if this integrated with the existing notification system too.',
  "Suggestion: make this available via API as well for our {department} team's automations.",
  "For our {teamSize} user deployment, we'd need this to scale well.",
  'Please consider accessibility when implementing this. Important for our team.',
  'Would love granular permissions on this feature for different user roles.',
  'If possible, add keyboard shortcuts too. Our power users would appreciate it.',
  'Consider adding this to the mobile app as well.',

  // Workarounds
  "For anyone looking for a workaround, I've been using Zapier to handle this. Not perfect but works.",
  'We built an internal tool to handle this but would much prefer a native solution.',
  "FYI - you can sort of do this with the API but it's pretty tedious.",
  'Our {department} team found a partial workaround using webhooks.',
  "We're using {competitor} just for this functionality until it's available here.",
  "There's a Chrome extension that helps with this, but not ideal.",
  'Our workaround involves manual exports. Takes about {hoursWasted} hours weekly.',
  'We scripted something using the API but it breaks often.',

  // Thank yous and celebrations
  'Thanks for shipping this! Works great so far. 🚀',
  "Finally! We've been waiting for this. Thank you team! 🙏",
  'Just tried it out - exactly what we needed. Great work!',
  'This is amazing! Our {department} team is thrilled.',
  'Excellent work on this. Saved us so much time already.',
  'Our {teamSize} users are happy now. Thank you!',
  'This exceeded our expectations. Well done! 👏',
  'Perfect implementation. Exactly what we asked for.',

  // Frustration (realistic but professional)
  "Really hoping this gets prioritized soon. It's blocking our adoption.",
  'This has been open for a while now. Any chance of movement?',
  "Honestly surprised this isn't built-in already. Seems like a basic feature.",
  'Our {department} team is getting frustrated with the lack of progress here.',
  "We've been waiting {timeframe} for this. Starting to consider alternatives.",
  'This is becoming a blocker for our renewal decision.',
  'Competitors like {competitor} already have this. Please catch up.',
  "We need this {timeframe} or we'll have to find another solution.",
  'The workarounds are costing us {hoursWasted} hours per week. Need a real solution.',
  'This has been "under review" for months. What\'s the holdup?',

  // Detailed responses
  'We have a similar need but slightly different use case:\n\n1. We need to export weekly\n2. It should include archived items\n3. PDF format preferred\n\nWould this cover our case?',
  "Adding some context on our use case: We're a {department} team and we need this for our quarterly reviews.",
  'Our requirements:\n- Must work with {teamSize}+ users\n- Needs to integrate with existing workflows\n- Should be available {timeframe}\n\nIs this feasible?',
  'For our {department} team, the key requirements are:\n1. Real-time sync\n2. Proper error handling\n3. Audit trail\n\nWould the planned implementation cover these?',
  'Just to add our perspective as a {teamSize} person {department} team: this would transform how we work.',
]

// Team member comment content - responses from the product team
const teamCommentContent = [
  // Asking for more info
  'Thanks for the feedback! Could you share more details about your specific use case? That would help us prioritize this correctly.',
  "Appreciate you reporting this! Can you tell us what browser/device you're using? That would help us investigate.",
  'Great suggestion! Quick question - would you need this to work with the existing API, or would a standalone feature work for you?',
  "Thanks for reaching out! Could you provide more context on your team size and how you'd use this feature?",
  'Interesting use case! Can you share more about your current workflow so we can design the best solution?',
  "We'd love to learn more about this. Would you be open to a quick call with our product team?",
  "Thanks for the detailed feedback! A few clarifying questions: How often would you use this? What's the expected scale?",
  "Appreciate the suggestion! Is this primarily for your team's internal use or customer-facing?",

  // Providing updates
  "Quick update: We've started investigating this and it's looking promising. Will share more details soon!",
  "Just wanted to let you know we're actively looking into this. Thanks for your patience!",
  'Update: Our engineering team has picked this up. Expect to see progress in the next sprint.',
  'Good news! This is now on our roadmap for the upcoming quarter. Stay tuned for updates.',
  "We've been working on this behind the scenes. Expect an announcement soon!",
  'This moved to "In Progress" today. Our team is actively building it now.',
  'Quick status update: Design is complete, engineering work starts next week.',
  "We've prioritized this based on community feedback. Thanks for your input!",
  'This is in final testing now. Should be released within the next few weeks.',
  'Update: We hit a few technical challenges but are making progress. Thanks for your patience!',

  // Helpful responses
  'In the meantime, you might be able to work around this by using our API. Happy to help if you need guidance!',
  "Pro tip: You can actually do something similar by using the webhooks feature. Let me know if you'd like more details!",
  'Thanks for the detailed report! This is really helpful for our investigation.',
  "While we work on this, here's a workaround that might help: [link to docs]",
  'Have you tried using our Zapier integration? It might solve this in the meantime.',
  'Great question! This is documented in our help center: [link]. Let me know if you need more help.',
  'For enterprise customers, we can offer a custom solution. Reach out to your account manager!',
  "We have a beta program for early access to new features. DM me if you're interested!",

  // Acknowledgments
  "Great idea! We've added this to our backlog. Thanks for taking the time to share your thoughts.",
  'We hear you! This is definitely something we want to improve.',
  'Logged this with the team. Really appreciate the feedback!',
  "Thanks for bringing this to our attention. We've flagged it for review.",
  "This is valuable feedback. We'll factor this into our planning discussions.",
  'Appreciate you taking the time to write this up. Very helpful for our team!',
  'Thank you! Community feedback like this helps us prioritize the right things.',
  "Noted! This aligns with feedback we've been hearing from other customers too.",

  // Bug acknowledgments
  "Thanks for the bug report! We've reproduced the issue and are working on a fix.",
  "We've identified the root cause. A fix will be deployed in the next release.",
  "This should be fixed now. Can you confirm it's working on your end?",
  "We've deployed a hotfix for this. Please refresh and let us know if the issue persists.",
  "Apologies for the inconvenience! We've prioritized this fix.",

  // Closing/resolution
  'This feature is now live! 🎉 Check it out and let us know what you think.',
  'Shipped! Thanks for the suggestion. We hope you find it useful.',
  'This has been resolved in our latest release. Thanks for your patience!',
  'Closing this as complete. Please open a new thread if you have additional feedback.',
  'Thanks everyone for the input! This is now available. See our changelog for details.',
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
  {
    name: 'Enterprise Features',
    slug: 'enterprise',
    description: 'Features for large teams and organizations',
  },
  {
    name: 'API & Developer',
    slug: 'api',
    description: 'API improvements and developer experience',
  },
  {
    name: 'Mobile App',
    slug: 'mobile',
    description: 'Mobile application feedback and requests',
  },
  {
    name: 'Security & Compliance',
    slug: 'security',
    description: 'Security features and compliance requirements',
  },
  {
    name: 'Performance',
    slug: 'performance',
    description: 'Speed, reliability, and performance improvements',
  },
  {
    name: 'Documentation',
    slug: 'docs',
    description: 'Documentation and learning resources',
  },
  {
    name: 'Analytics & Reporting',
    slug: 'analytics',
    description: 'Data insights and reporting features',
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

/**
 * Convert plain text to TipTap JSON format.
 * This ensures both `content` and `contentJson` fields are properly populated.
 */
function textToTipTapJson(text: string): object {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  }
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

/**
 * Generate vote count with realistic power-law distribution (enterprise scale).
 * - 40% of posts: 0-20 votes (low engagement)
 * - 30% of posts: 20-100 votes (moderate)
 * - 15% of posts: 100-500 votes (popular)
 * - 10% of posts: 500-2000 votes (very popular)
 * - 5% of posts: 2000+ votes (viral)
 */
function generateVoteCount(): number {
  const roll = Math.random()
  if (roll < 0.4) return Math.floor(Math.random() * 21)
  if (roll < 0.7) return 20 + Math.floor(Math.random() * 81)
  if (roll < 0.85) return 100 + Math.floor(Math.random() * 401)
  if (roll < 0.95) return 500 + Math.floor(Math.random() * 1501)
  return 2000 + Math.floor(Math.random() * 3001)
}

/**
 * Generate comment count with realistic power-law distribution (enterprise scale).
 * - 35% of posts: 0-5 comments (minimal engagement)
 * - 30% of posts: 5-25 comments (some discussion)
 * - 20% of posts: 25-75 comments (active thread)
 * - 10% of posts: 75-200 comments (popular)
 * - 5% of posts: 200-500 comments (viral)
 */
function generateCommentCount(): number {
  const roll = Math.random()
  if (roll < 0.35) return Math.floor(Math.random() * 6)
  if (roll < 0.65) return 5 + Math.floor(Math.random() * 21)
  if (roll < 0.85) return 25 + Math.floor(Math.random() * 51)
  if (roll < 0.95) return 75 + Math.floor(Math.random() * 126)
  return 200 + Math.floor(Math.random() * 301)
}

async function seed() {
  console.log('🌱 Seeding database with faker data...\n')

  // Verify migrations have been applied
  console.log('🔐 Verifying migrations...')
  await verifyMigrationsApplied()
  console.log('   Migrations verified')

  // Optimize for bulk inserts
  console.log('⚡ Optimizing for bulk inserts...')
  await optimizeForBulkInsert()
  console.log('   Database optimized\n')

  // Pre-hash the demo password (used for all seeded accounts)
  const hashedPassword = hashPassword(DEMO_USER.password)

  // =========================================================================
  // Create Organizations FIRST (users now require organizationId)
  // =========================================================================
  console.log('🏢 Creating organizations...')

  const orgRecords: Array<{ id: string; name: string; slug: string }> = []

  // Create demo org first
  const demoOrgId = uuid()
  await db.insert(organization).values({
    id: demoOrgId,
    name: DEMO_ORG.name,
    slug: DEMO_ORG.slug,
    logo: null,
    createdAt: new Date(),
  })
  // Create workspace domain for demo org
  await db.insert(workspaceDomain).values({
    id: uuid(),
    organizationId: demoOrgId,
    domain: `${DEMO_ORG.slug}.localhost:3000`,
    domainType: 'subdomain',
    isPrimary: true,
    verified: true,
  })
  orgRecords.push({ id: demoOrgId, name: DEMO_ORG.name, slug: DEMO_ORG.slug })

  console.log(`   Created ${orgRecords.length} organization`)

  // =========================================================================
  // Create Default Statuses (per organization)
  // =========================================================================
  console.log('📊 Creating default statuses...')

  for (const org of orgRecords) {
    for (const statusData of DEFAULT_STATUSES) {
      await db.insert(postStatuses).values({
        organizationId: org.id,
        ...statusData,
      })
    }
  }

  console.log(`   Created ${DEFAULT_STATUSES.length} statuses per organization`)

  // =========================================================================
  // Create Users (with organizationId - tenant isolation)
  // =========================================================================
  console.log('👤 Creating users...')

  const demoUserId = uuid()
  const userRecords: Array<{ id: string; name: string; email: string; orgId: string }> = []

  // Create demo user in demo org (fixed credentials)
  await db.insert(user).values({
    id: demoUserId,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
    emailVerified: true,
    organizationId: demoOrgId,
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

  // Also create member record for demo user
  await db.insert(member).values({
    id: uuid(),
    organizationId: demoOrgId,
    userId: demoUserId,
    role: 'owner',
    createdAt: new Date(),
  })

  userRecords.push({
    id: demoUserId,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
    orgId: demoOrgId,
  })

  // Create users for the demo organization
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
      organizationId: demoOrgId,
      createdAt: randomDate(180),
      updatedAt: new Date(),
    })

    // Also create member record
    await db.insert(member).values({
      id: uuid(),
      organizationId: demoOrgId,
      userId: userId,
      role: pick(['admin', 'member', 'member', 'member']),
      createdAt: randomDate(90),
    })

    // Some users have password accounts
    if (faker.datatype.boolean({ probability: 0.7 })) {
      await db.insert(account).values({
        id: uuid(),
        accountId: userId,
        providerId: 'credential',
        userId: userId,
        password: hashedPassword,
        createdAt: randomDate(180),
        updatedAt: new Date(),
      })
    }

    userRecords.push({ id: userId, name, email, orgId: demoOrgId })
  }

  console.log(`   Created ${userRecords.length} users`)

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
  // Create Posts (batch insert with power-law distributions)
  // =========================================================================
  console.log('📝 Creating posts...')

  // Build flat list of all boards with their org context
  const allBoards: Array<{
    boardId: string
    orgId: string
    orgTags: Array<{ id: string; name: string; color: string }>
    orgMembers: Array<{ id: string; name: string; email: string; orgId: string }>
    roadmapId?: string
  }> = []

  for (const org of orgRecords) {
    const orgBoards = boardRecords.get(org.id) || []
    const orgTags = tagRecords.get(org.id) || []
    const orgMembers = userRecords.filter((u) => u.orgId === org.id)

    for (const board of orgBoards) {
      const roadmap = roadmapRecords.get(board.id)
      allBoards.push({
        boardId: board.id,
        orgId: org.id,
        orgTags,
        orgMembers,
        roadmapId: roadmap?.id,
      })
    }
  }

  let totalPosts = 0
  const postRecords: Array<{
    id: string
    boardId: string
    orgId: string
    voteCount: number
    commentCount: number
  }> = []

  // Generate posts in batches
  const totalBatches = Math.ceil(CONFIG.totalPosts / CONFIG.batchSize)

  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * CONFIG.batchSize
    const batchEnd = Math.min(batchStart + CONFIG.batchSize, CONFIG.totalPosts)
    const batchSize = batchEnd - batchStart

    process.stdout.write(`   Batch ${batch + 1}/${totalBatches} (${batchSize} posts)...`)

    const postInserts: (typeof posts.$inferInsert)[] = []
    const postTagInserts: (typeof postTags.$inferInsert)[] = []
    const postRoadmapInserts: (typeof postRoadmaps.$inferInsert)[] = []

    for (let i = 0; i < batchSize; i++) {
      const postId = uuid()
      // Distribute posts across boards
      const boardCtx = pick(allBoards)

      const author = pick(boardCtx.orgMembers)
      const isAnonymous = faker.datatype.boolean({ probability: 0.15 })
      const status = weightedStatus()
      const createdAt = randomDate(365)
      const voteCount = generateVoteCount()
      const commentCount = generateCommentCount()

      const hasOfficialResponse = status !== 'open' && faker.datatype.boolean({ probability: 0.7 })
      const responder = hasOfficialResponse ? pick(boardCtx.orgMembers) : null

      // Get category-aware title and content with templates filled
      const category = getRandomCategory()
      const { title: postTitle, content: postContent } = getCategorizedPostContent(category)

      postInserts.push({
        id: postId,
        boardId: boardCtx.boardId,
        title: postTitle,
        content: postContent,
        contentJson: textToTipTapJson(postContent),
        authorId: isAnonymous ? null : author.id,
        authorName: isAnonymous ? 'Anonymous' : author.name,
        authorEmail: isAnonymous ? null : author.email,
        status,
        voteCount,
        ownerId: faker.datatype.boolean({ probability: 0.3 }) ? pick(boardCtx.orgMembers).id : null,
        estimated: faker.datatype.boolean({ probability: 0.2 })
          ? pick(['small', 'medium', 'large'])
          : null,
        officialResponse: hasOfficialResponse ? pick(officialResponses) : null,
        officialResponseAuthorId: responder?.id ?? null,
        officialResponseAuthorName: responder?.name ?? null,
        officialResponseAt: hasOfficialResponse ? randomDate(30) : null,
        createdAt,
        updatedAt: new Date(),
      })

      postRecords.push({
        id: postId,
        boardId: boardCtx.boardId,
        orgId: boardCtx.orgId,
        voteCount,
        commentCount,
      })

      // Add tags (0-3 per post)
      const postTagCount = randomInt(0, 3)
      if (postTagCount > 0 && boardCtx.orgTags.length > 0) {
        const selectedTags = pickMultiple(
          boardCtx.orgTags,
          Math.min(postTagCount, boardCtx.orgTags.length)
        )
        for (const tag of selectedTags) {
          postTagInserts.push({ postId, tagId: tag.id })
        }
      }

      // Add to roadmap if applicable
      if (
        boardCtx.roadmapId &&
        ['planned', 'in_progress', 'complete'].includes(status) &&
        faker.datatype.boolean({ probability: 0.7 })
      ) {
        postRoadmapInserts.push({ postId, roadmapId: boardCtx.roadmapId })
      }

      totalPosts++
    }

    // Batch insert
    await db.insert(posts).values(postInserts)
    if (postTagInserts.length > 0) {
      await db.insert(postTags).values(postTagInserts)
    }
    if (postRoadmapInserts.length > 0) {
      await db.insert(postRoadmaps).values(postRoadmapInserts)
    }

    console.log(' ✓')
  }

  console.log(`   Created ${totalPosts} posts`)

  // =========================================================================
  // Create Comments (UNNEST bulk insert - much faster than parameterized INSERT)
  // =========================================================================
  console.log('💬 Creating comments...')

  // Generate all comment data as arrays for UNNEST
  // Use strings for all types to avoid postgres.js array serialization issues
  const commentIds: string[] = []
  const commentPostIds: string[] = []
  const commentAuthorIds: (string | null)[] = []
  const commentAuthorNames: string[] = []
  const commentAuthorEmails: (string | null)[] = []
  const commentContents: string[] = []
  const commentIsTeamMembers: string[] = [] // 't'/'f' for PostgreSQL boolean
  const commentCreatedAts: string[] = [] // ISO strings for timestamps
  let teamComments = 0

  for (const post of postRecords) {
    for (let i = 0; i < post.commentCount; i++) {
      const author = pick(userRecords)
      const isAnonymous = faker.datatype.boolean({ probability: 0.2 })
      const isTeamMember = faker.datatype.boolean({ probability: 0.15 })

      const rawContent = isTeamMember ? pick(teamCommentContent) : pick(commentContent)
      const filledContent = fillTemplate(rawContent)

      commentIds.push(uuid())
      commentPostIds.push(post.id)
      commentAuthorIds.push(isAnonymous ? null : author.id)
      commentAuthorNames.push(isAnonymous ? faker.person.fullName() : author.name)
      commentAuthorEmails.push(isAnonymous ? faker.internet.email().toLowerCase() : author.email)
      commentContents.push(filledContent)
      commentIsTeamMembers.push(isTeamMember ? 't' : 'f')
      commentCreatedAts.push(randomDate(60).toISOString())

      if (isTeamMember) teamComments++
    }
  }

  // UNNEST allows inserting unlimited rows with just 8 parameters
  const COMMENT_BATCH_SIZE = 100000 // Much larger batches possible with UNNEST
  const totalCommentBatches = Math.ceil(commentIds.length / COMMENT_BATCH_SIZE)

  console.log(
    `   Inserting ${commentIds.length} comments in ${totalCommentBatches} batches (UNNEST)...`
  )

  for (let i = 0; i < commentIds.length; i += COMMENT_BATCH_SIZE) {
    const end = Math.min(i + COMMENT_BATCH_SIZE, commentIds.length)
    await client.unsafe(
      `
      INSERT INTO comments (id, post_id, author_id, author_name, author_email, content, is_team_member, created_at)
      SELECT * FROM unnest($1::text[]::uuid[], $2::text[]::uuid[], $3::text[]::uuid[], $4::text[], $5::text[], $6::text[], $7::text[]::boolean[], $8::text[]::timestamptz[])
    `,
      [
        commentIds.slice(i, end),
        commentPostIds.slice(i, end),
        commentAuthorIds.slice(i, end),
        commentAuthorNames.slice(i, end),
        commentAuthorEmails.slice(i, end),
        commentContents.slice(i, end),
        commentIsTeamMembers.slice(i, end),
        commentCreatedAts.slice(i, end),
      ]
    )
    process.stdout.write(
      `   Batch ${Math.floor(i / COMMENT_BATCH_SIZE) + 1}/${totalCommentBatches} complete\r`
    )
  }

  console.log(
    `   Created ${commentIds.length} comments (${teamComments} from team members)                `
  )

  // =========================================================================
  // Create Votes (UNNEST bulk insert - much faster than parameterized INSERT)
  // =========================================================================
  console.log('👍 Creating votes...')

  // Generate all vote data as arrays (strings for postgres.js array serialization)
  const voteIds: string[] = []
  const votePostIds: string[] = []
  const voteUserIds: string[] = []
  const voteCreatedAts: string[] = [] // ISO strings for timestamps

  for (const post of postRecords) {
    const shuffledUsers = [...userRecords].sort(() => Math.random() - 0.5)

    for (let v = 0; v < post.voteCount; v++) {
      let userIdentifier: string

      if (v < shuffledUsers.length && faker.datatype.boolean({ probability: 0.7 })) {
        userIdentifier = shuffledUsers[v].id
      } else {
        userIdentifier = `anon_${post.id.slice(0, 8)}_${v}`
      }

      voteIds.push(uuid())
      votePostIds.push(post.id)
      voteUserIds.push(userIdentifier)
      voteCreatedAts.push(randomDate(90).toISOString())
    }
  }

  // UNNEST allows inserting unlimited rows with just 4 parameters
  const VOTE_BATCH_SIZE = 100000 // Much larger batches possible with UNNEST
  const totalVoteBatches = Math.ceil(voteIds.length / VOTE_BATCH_SIZE)

  console.log(`   Inserting ${voteIds.length} votes in ${totalVoteBatches} batches (UNNEST)...`)

  for (let i = 0; i < voteIds.length; i += VOTE_BATCH_SIZE) {
    const end = Math.min(i + VOTE_BATCH_SIZE, voteIds.length)
    await client.unsafe(
      `
      INSERT INTO votes (id, post_id, user_identifier, created_at)
      SELECT * FROM unnest($1::text[]::uuid[], $2::text[]::uuid[], $3::text[], $4::text[]::timestamptz[])
    `,
      [
        voteIds.slice(i, end),
        votePostIds.slice(i, end),
        voteUserIds.slice(i, end),
        voteCreatedAts.slice(i, end),
      ]
    )
    process.stdout.write(
      `   Batch ${Math.floor(i / VOTE_BATCH_SIZE) + 1}/${totalVoteBatches} complete\r`
    )
  }

  console.log(`   Created ${voteIds.length} votes                              `)

  // =========================================================================
  // Cleanup
  // =========================================================================
  await resetDatabaseSettings()

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
    console.log(`    http://${org.slug}.localhost:3000`)
  }
  console.log('')
  console.log('Summary:')
  console.log(`  • ${userRecords.length} users`)
  console.log(`  • ${orgRecords.length} organizations`)
  console.log(`  • ${totalPosts} posts`)
  console.log(`  • ${commentIds.length} comments`)
  console.log(`  • ${voteIds.length} votes`)
  console.log('━'.repeat(50))

  await client.end()
}

seed().catch(async (error) => {
  console.error('Seed failed:', error)
  await client.end()
  process.exitCode = 1
})
