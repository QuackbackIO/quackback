import { useRouter } from '@tanstack/react-router'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'

type RootContext = {
  settings?: { helpCenterConfig?: { locales?: { default?: string } } } | null
}

/**
 * The help center's main language (the workspace's main language): the
 * language of an article or collection that has no translation, so the one
 * links and searches use when no other language is given. It changes only
 * with the workspace settings, which arrive with the page. Without a router
 * (a component rendered on its own, in a test) it is the default.
 */
export function useHelpCenterMainLanguage(): string {
  const router = useRouter({ warn: false })
  const root = router?.state.matches[0]?.context as RootContext | undefined
  return root?.settings?.helpCenterConfig?.locales?.default ?? DEFAULT_LOCALE
}
