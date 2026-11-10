/**
 * Sample content for the designer: fixed, made-up data a page is drawn from
 * when its part is off or has nothing to show yet. Nothing here is read from
 * or written to the database, and only the designer is served it (see
 * `getDesignerSampleFn`). Names are generic and addresses use example.com.
 */
import type { getStatusPageFn } from '@/lib/server/functions/status'
import type { SamplePage } from '@/lib/shared/design/sample-pages'
import { sampleChangelog, sampleFeedback, sampleRoadmap } from './sample-portal'
import { sampleSupport, type SampleSupport } from './sample-support'

type StatusPageData = Awaited<ReturnType<typeof getStatusPageFn>>
type Snapshot = StatusPageData['snapshot']
type Incident = Snapshot['activeIncidents'][number]
type Component = Snapshot['ungroupedComponents'][number]

export interface SampleCategory {
  id: string
  urlId: number
  parentId: null
  slug: string
  name: string
  icon: string | null
  description: string | null
  articleCount: number
}

export interface SampleArticle {
  id: string
  urlId: number
  slug: string
  title: string
  categorySlug: string
  categoryName: string
}

export type SampleContent =
  | { page: 'status'; status: StatusPageData }
  | {
      page: 'help'
      help: { categories: SampleCategory[]; popularArticles: SampleArticle[] }
    }
  | { page: 'support'; support: SampleSupport }
  | { page: 'feedback'; feedback: ReturnType<typeof sampleFeedback> }
  | { page: 'roadmap'; roadmap: ReturnType<typeof sampleRoadmap> }
  | { page: 'changelog'; changelog: ReturnType<typeof sampleChangelog> }

const DAY = 86_400_000
/** Fixture ids say what they are; no row anywhere has one. */
const sampleId = <T>(name: string) => `sample_${name}` as T

function component(name: string, description: string, status: Component['status']): Component {
  return {
    id: sampleId(`component_${name.toLowerCase().replace(/\W+/g, '_')}`),
    name,
    description,
    status,
    showUptime: true,
  }
}

function day(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * DAY).toISOString().slice(0, 10)
}

function sampleStatus(now: Date): StatusPageData {
  const api = component('API', 'Requests to api.example.com', 'operational')
  const web = component('Web app', 'The app at app.example.com', 'operational')
  const email = component('Email delivery', 'Notifications and receipts', 'degraded_performance')
  const search = component('Search', 'Finding records across the app', 'operational')
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString()
  const active: Incident = {
    id: sampleId('incident_email'),
    kind: 'incident',
    title: 'Some emails are arriving late',
    status: 'monitoring',
    impact: 'minor',
    scheduledStartAt: null,
    scheduledEndAt: null,
    startedAt: at(3),
    resolvedAt: null,
    affectedComponents: [
      { id: email.id, name: email.name, componentStatus: 'degraded_performance' },
    ],
    updates: [
      {
        id: sampleId('update_email_1'),
        status: 'investigating',
        body: 'We are looking into delays in email delivery.',
        createdAt: at(3),
      },
      {
        id: sampleId('update_email_2'),
        status: 'monitoring',
        body: 'A fix is in place and delayed emails are being sent. We are watching closely.',
        createdAt: at(1),
      },
    ],
  }
  const maintenance: Incident = {
    id: sampleId('maintenance_database'),
    kind: 'maintenance',
    title: 'Database upgrade',
    status: 'scheduled',
    impact: 'maintenance',
    scheduledStartAt: at(-72),
    scheduledEndAt: at(-74),
    startedAt: at(-72),
    resolvedAt: null,
    affectedComponents: [{ id: api.id, name: api.name, componentStatus: 'operational' }],
    updates: [
      {
        id: sampleId('update_maintenance_1'),
        status: 'scheduled',
        body: 'The API may be slower for a few minutes.',
        createdAt: at(24),
      },
    ],
  }
  const past: Incident = {
    id: sampleId('incident_search'),
    kind: 'incident',
    title: 'Search results were incomplete',
    status: 'resolved',
    impact: 'minor',
    scheduledStartAt: null,
    scheduledEndAt: null,
    startedAt: at(24 * 6),
    resolvedAt: at(24 * 6 - 2),
    affectedComponents: [{ id: search.id, name: search.name, componentStatus: 'operational' }],
    updates: [
      {
        id: sampleId('update_search_1'),
        status: 'identified',
        body: 'Recently added records were missing from search.',
        createdAt: at(24 * 6),
      },
      {
        id: sampleId('update_search_2'),
        status: 'resolved',
        body: 'Search is complete again.',
        createdAt: at(24 * 6 - 2),
      },
    ],
  }
  const uptime = [api, web, email, search].map((each) => ({
    componentId: each.id,
    days: Array.from({ length: 90 }, (_, index) => {
      const daysAgo = 89 - index
      const rough = (each === email && daysAgo === 0) || (each === search && daysAgo === 6)
      return {
        date: day(now, daysAgo),
        worstStatus: rough ? ('degraded_performance' as const) : ('operational' as const),
        uptimePct: rough ? 98.5 : 100,
      }
    }),
  }))
  return {
    snapshot: {
      topLevel: {
        status: 'degraded_performance',
        worstComponentStatus: 'degraded_performance',
        activeIncidentCount: 1,
      },
      groups: [
        {
          id: sampleId('group_core'),
          name: 'Core services',
          collapsed: false,
          components: [api, web],
        },
      ],
      ungroupedComponents: [email, search],
      activeIncidents: [active],
      upcomingMaintenance: [maintenance],
      recentIncidents: [{ date: day(now, 6), incidents: [past] }],
      recentWindow: { start: new Date(now.getTime() - 14 * DAY).toISOString(), days: 14 },
    },
    settings: { pageDescription: null, audience: 'public' },
    uptime,
  } as StatusPageData
}

const CATEGORIES: Array<[string, string, string, number]> = [
  ['Getting started', 'Set up your account and invite your team.', 'RocketLaunchIcon', 6],
  ['Account and billing', 'Plans, invoices and payment details.', 'CreditCardIcon', 8],
  ['Using the app', 'Everyday tasks, step by step.', 'BookOpenIcon', 12],
  ['Integrations', 'Connect the tools you already use.', 'PuzzlePieceIcon', 5],
  ['Troubleshooting', 'Fixes for common problems.', 'WrenchScrewdriverIcon', 7],
  ['Security and privacy', 'How your data is kept safe.', 'ShieldCheckIcon', 4],
]

const ARTICLES: Array<[string, number]> = [
  ['Inviting people to your workspace', 0],
  ['Changing your plan', 1],
  ['Exporting your data', 2],
  ['Connecting your calendar', 3],
  ['Resetting your password', 4],
  ['Turning on two-step sign-in', 5],
]

function sampleHelp(): Extract<SampleContent, { page: 'help' }>['help'] {
  const slug = (name: string) => name.toLowerCase().replace(/\W+/g, '-')
  const categories = CATEGORIES.map(([name, description, icon, articleCount], index) => ({
    id: sampleId<string>(`category_${index}`),
    urlId: index + 1,
    parentId: null,
    slug: slug(name),
    name,
    icon,
    description,
    articleCount,
  }))
  const popularArticles = ARTICLES.map(([title, category], index) => ({
    id: sampleId<string>(`article_${index}`),
    urlId: index + 1,
    slug: slug(title),
    title,
    categorySlug: categories[category]!.slug,
    categoryName: categories[category]!.name,
  }))
  return { categories, popularArticles }
}

/** A page's sample, dated around `now` so it reads as current. */
export function sampleContent(page: SamplePage, now: Date = new Date()): SampleContent {
  switch (page) {
    case 'status':
      return { page, status: sampleStatus(now) }
    case 'help':
      return { page, help: sampleHelp() }
    case 'support':
      return { page, support: sampleSupport(now) }
    case 'feedback':
      return { page, feedback: sampleFeedback(now) }
    case 'roadmap':
      return { page, roadmap: sampleRoadmap(now) }
    case 'changelog':
      return { page, changelog: sampleChangelog(now) }
  }
}
