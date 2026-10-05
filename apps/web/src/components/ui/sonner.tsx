import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid'
import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { normalizeLocale, type SupportedLocale } from '@/lib/shared/i18n'

/**
 * The toast region's name for screen readers. The toaster sits above every
 * surface's message catalogue, so it carries the one word itself; the words
 * match each catalogue's "Notifications" (portal.notifications.title).
 */
const REGION_LABEL: Record<SupportedLocale, string> = {
  en: 'Notifications',
  de: 'Benachrichtigungen',
  fr: 'Notifications',
  es: 'Notificaciones',
  ar: 'الإشعارات',
  ru: 'Уведомления',
  'pt-br': 'Notificações',
  'zh-cn': '通知',
  'zh-tw': '通知',
  nl: 'Meldingen',
  pl: 'Powiadomienia',
}

// A surface whose language the document does not carry (the admin picks its
// own) tells the toaster here; the last one mounted wins.
let surfaceLocale: string | null = null
const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function setSurfaceLocale(locale: string | null) {
  surfaceLocale = locale
  for (const listener of listeners) listener()
}

function regionLabel(locale: string | null | undefined): string {
  return REGION_LABEL[normalizeLocale(locale ?? '') ?? 'en']
}

/**
 * Names the toast region in a surface's language until the returned function
 * is called. Surfaces reach it through `useToasterLocale`.
 */
export function setToasterLocale(locale: string): () => void {
  setSurfaceLocale(locale)
  return () => {
    if (surfaceLocale === locale) setSurfaceLocale(null)
  }
}

function Toaster({
  locale,
  ...props
}: ToasterProps & { /** The page language. */ locale?: string }): React.ReactElement {
  const { theme = 'system' } = useTheme()
  // The label itself is the snapshot, so a surface that picks the language
  // the page already has does not render the toaster again.
  const label = useSyncExternalStore(
    subscribe,
    () => regionLabel(surfaceLocale ?? locale),
    () => regionLabel(locale)
  )

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      containerAriaLabel={label}
      icons={{
        success: <CheckCircleIcon className="size-4" />,
        info: <InformationCircleIcon className="size-4" />,
        warning: <ExclamationTriangleIcon className="size-4" />,
        error: <XCircleIcon className="size-4" />,
        loading: (
          <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ),
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
