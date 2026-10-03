import { buildNavSections, isNavModule, navSectionsFor } from './settings-nav-sections'
import { SETTINGS_PAGES } from './settings-pages'
import { PERMISSIONS, type PermissionKey } from './permissions'
import { isProductEnabled, type FeatureFlags, type ProductId } from './types/settings'
import type { OnboardingOutcome } from './db-types'

export interface AskDestination {
  id: string
  href: string
  messageId: string
  defaultMessage: string
  keywords: string[]
  kind: 'page' | 'settings'
}

export interface AskDestinationOptions {
  permissions: ReadonlySet<PermissionKey>
  featureFlags?: Partial<FeatureFlags>
  billingEnabled?: boolean
  domainsEnabled?: boolean
}

interface ProductDestination {
  href: string
  label: string
  product?: ProductId
  permissions?: readonly PermissionKey[]
}

const PRODUCTS: ProductDestination[] = [
  { href: '/admin', label: 'Home' },
  {
    href: '/admin/feedback',
    label: 'Feedback',
    product: 'feedback',
    permissions: [PERMISSIONS.POST_VIEW_PRIVATE],
  },
  {
    href: '/admin/roadmap',
    label: 'Roadmap',
    product: 'feedback',
    permissions: [PERMISSIONS.POST_VIEW_PRIVATE],
  },
  {
    href: '/admin/changelog',
    label: 'Changelog',
    product: 'changelog',
    permissions: [PERMISSIONS.CHANGELOG_VIEW_DRAFT, PERMISSIONS.CHANGELOG_MANAGE],
  },
  {
    href: '/admin/inbox',
    label: 'Support',
    product: 'support',
    permissions: [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.TICKET_VIEW],
  },
  {
    href: '/admin/help-center',
    label: 'Help Center',
    product: 'helpCenter',
    permissions: [PERMISSIONS.HELP_CENTER_MANAGE],
  },
  {
    href: '/admin/status',
    label: 'Status',
    product: 'status',
    permissions: [PERMISSIONS.STATUS_PAGE_MANAGE, PERMISSIONS.STATUS_PAGE_PUBLISH],
  },
  { href: '/admin/analytics', label: 'Analytics', permissions: [PERMISSIONS.ANALYTICS_VIEW] },
  { href: '/admin/users', label: 'Users', permissions: [PERMISSIONS.PEOPLE_VIEW] },
  { href: '/admin/getting-started', label: 'Launch plan' },
]

const KEYWORDS: Record<string, string[]> = {
  '/admin/settings/members': ['invite', 'team', 'roles'],
  '/admin/settings/billing': ['plan', 'upgrade', 'payment', 'subscription'],
  '/admin/settings/security/authentication': ['sso', 'sign in', 'authentication', 'login'],
  '/admin/settings/developers': ['api', 'keys', 'webhooks'],
  '/admin/settings/widget': ['messenger', 'welcome', 'chat'],
  '/admin/settings/widget/install': ['install', 'snippet', 'website', 'embed'],
  '/admin/settings/portal': ['branding', 'logo', 'color', 'theme', 'header'],
  '/admin/settings/general': ['modules', 'workspace', 'name'],
}

function destination(href: string, label: string): AskDestination {
  const id = href.replace(/^\/admin\/?/, '').replaceAll('/', '_') || 'home'
  return {
    id,
    href,
    messageId: `ask.destination.${id}`,
    defaultMessage: label,
    keywords: KEYWORDS[href] ?? [],
    kind: href.startsWith('/admin/settings/') ? 'settings' : 'page',
  }
}

/** The palette reads the same flat page and module permission gates as Settings. */
export function buildAskDestinations(options: AskDestinationOptions): AskDestination[] {
  const { permissions, featureFlags, billingEnabled = false, domainsEnabled = false } = options
  const result = PRODUCTS.filter(
    (item) =>
      (!item.product || isProductEnabled(featureFlags, item.product)) &&
      (!item.permissions || item.permissions.some((permission) => permissions.has(permission)))
  ).map((item) => destination(item.href, item.label))

  const sections = navSectionsFor(
    buildNavSections(featureFlags, billingEnabled, domainsEnabled),
    permissions
  )
  for (const section of sections) {
    for (const entry of section.items) {
      if (isNavModule(entry)) {
        result.push(destination(entry.id, entry.label))
        result.push(...entry.pages.map((page) => destination(page.to, page.label)))
      } else result.push(destination(entry.to, entry.label))
    }
  }

  if (permissions.has(PERMISSIONS.SETTINGS_MANAGE)) {
    result.push(
      destination(
        '/admin/settings/widget/install',
        SETTINGS_PAGES['/admin/settings/widget/install'].label
      )
    )
    if (featureFlags?.supportInbox) {
      result.push(
        destination(
          '/admin/settings/channels/messenger',
          SETTINGS_PAGES['/admin/settings/channels/messenger'].label
        )
      )
    }
  }
  if (featureFlags?.supportInbox && permissions.has(PERMISSIONS.CHANNEL_ACCOUNT_MANAGE)) {
    for (const path of [
      '/admin/settings/channels/email',
      '/admin/settings/channels/github',
    ] as const) {
      result.push(destination(path, SETTINGS_PAGES[path].label))
    }
  }
  return [...new Map(result.map((item) => [item.href, item])).values()]
}

/** Local translated navigation search never calls a provider. */
export function searchAskDestinations(
  query: string,
  options: AskDestinationOptions,
  label: (item: AskDestination) => string = (item) => item.defaultMessage
): AskDestination[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return buildAskDestinations(options)
    .filter((item) => {
      const text = [label(item), item.defaultMessage, ...item.keywords]
        .join(' ')
        .toLocaleLowerCase()
      return terms.every((term) => text.includes(term))
    })
    .slice(0, 8)
}

export interface AskStarterPrompt {
  id: string
  defaultMessage: string
}

const STARTERS = {
  branding: { id: 'ask.starter.branding', defaultMessage: 'Set my brand color' },
  invite: { id: 'ask.starter.invite', defaultMessage: 'Invite my team' },
  install: { id: 'ask.starter.install', defaultMessage: 'Put Messenger on my site' },
  welcome: { id: 'ask.starter.welcome', defaultMessage: 'Write a welcome message' },
  feedback: { id: 'ask.starter.feedback', defaultMessage: 'Set up my feedback board' },
  help: { id: 'ask.starter.help', defaultMessage: 'Create my first help article' },
  status: { id: 'ask.starter.status', defaultMessage: 'Add my first service' },
} satisfies Record<string, AskStarterPrompt>

export function buildAskStarterPrompts(
  goals: readonly OnboardingOutcome[],
  completedTaskIds: readonly string[] = []
): AskStarterPrompt[] {
  const completed = new Set(completedTaskIds)
  const selected: AskStarterPrompt[] = []
  for (const goal of goals) {
    if (goal === 'customer_support') {
      if (!completed.has('connect-messenger')) selected.push(STARTERS.install)
      selected.push(STARTERS.welcome)
    } else if (goal === 'help_center' && !completed.has('help-article'))
      selected.push(STARTERS.help)
    else if (goal === 'status_page' && !completed.has('add-status-service'))
      selected.push(STARTERS.status)
    else if (goal === 'product_feedback' || goal === 'internal') selected.push(STARTERS.feedback)
  }
  if (!completed.has('customize-branding')) selected.push(STARTERS.branding)
  if (!completed.has('invite-team')) selected.push(STARTERS.invite)
  const unique = [...new Map(selected.map((item) => [item.id, item])).values()]
  for (const fallback of [STARTERS.branding, STARTERS.invite, STARTERS.install]) {
    if (unique.length >= 3) break
    if (!unique.some((item) => item.id === fallback.id)) unique.push(fallback)
  }
  return unique.slice(0, 4)
}

/** Exported copy lets every locale share one complete catalogue. */
export const ASK_CATALOGUE_MESSAGES = Object.fromEntries([
  ...buildAskDestinations({
    permissions: new Set(Object.values(PERMISSIONS)),
    featureFlags: {
      feedback: true,
      supportInbox: true,
      supportTickets: true,
      helpCenter: true,
      statusPage: true,
      changelog: true,
    },
    billingEnabled: true,
    domainsEnabled: true,
  }).map((item) => [item.messageId, item.defaultMessage]),
  ...Object.values(STARTERS).map((item) => [item.id, item.defaultMessage]),
]) as Record<string, string>
