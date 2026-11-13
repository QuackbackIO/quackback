import { Link, useHydrated, useRouterState } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { UserIcon, Cog6ToothIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'

const navItems = [
  {
    label: { id: 'portal.settings.profile.title', defaultMessage: 'Profile' },
    to: '/settings/profile',
    icon: UserIcon,
  },
  {
    label: { id: 'portal.settings.preferences.title', defaultMessage: 'Preferences' },
    to: '/settings/preferences',
    icon: Cog6ToothIcon,
  },
]

/**
 * A key, drawn here rather than imported: the icon package's key also sits in
 * the help center's icon set, and sharing it would split it into a chunk of
 * its own on every page.
 */
export function KeyGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 7a5 5 0 1 1 3.61 4.804l-1.903 1.903A1 1 0 0 1 9 14H8v1a1 1 0 0 1-1 1H6v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2a1 1 0 0 1 .293-.707L8.196 8.39A5.002 5.002 0 0 1 8 7Zm5-3a.75.75 0 0 0 0 1.5A1.5 1.5 0 0 1 14.5 7 .75.75 0 0 0 16 7a3 3 0 0 0-3-3Z"
      />
    </svg>
  )
}

const API_KEYS_PATH = '/settings/api-keys'

/** Team members only: personal API keys act as their creator. */
const apiKeysItem = {
  label: { id: 'portal.settings.nav.apiKeys', defaultMessage: 'API keys' },
  to: API_KEYS_PATH,
  icon: KeyGlyph,
}

export function SettingsNav({ showApiKeys = false }: { showApiKeys?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // The API keys tab is added once the page is live, so the profile and
  // preferences documents stay as small as they were; its own page has it
  // from the server.
  const hydrated = useHydrated()
  const withApiKeys = showApiKeys && (hydrated || pathname.startsWith(API_KEYS_PATH))
  const items = withApiKeys ? [...navItems, apiKeysItem] : navItems

  return (
    <nav className="w-full md:w-56 md:shrink-0">
      <div className="sticky top-[calc(var(--portal-header-height,0px)+1.5rem)] bg-card border border-border/50 rounded-lg p-4 shadow-sm">
        <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 px-3">
          <FormattedMessage id="portal.settings.nav.personal" defaultMessage="Personal" />
        </h3>
        <ul className="space-y-0.5">
          {items.map((item) => {
            const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
            const Icon = item.icon

            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors',
                    isActive
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                  <span className="truncate">
                    <FormattedMessage {...item.label} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
