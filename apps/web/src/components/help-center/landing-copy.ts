// Its own module so a route's head can use it without pulling the landing
// page, its search and Ask AI into the entry chunk.
import { DEFAULT_HELP_CENTER_CONFIG, type HelpCenterConfig } from '@/lib/shared/types/settings'

type Copy = { id: string; defaultMessage: string }

/**
 * The landing title and description: an admin's own wording, or the defaults
 * in the page's language. Settings store the English defaults until an admin
 * edits them, so a stored default is worded like a missing one. `word` turns a
 * message into the page's language (react-intl in the page, the help center's
 * loaded strings in `head`).
 */
export function landingCopy(
  config: HelpCenterConfig | null | undefined,
  word: (copy: Copy) => string
) {
  const storedTitle = config?.homepageTitle
  const title =
    storedTitle == null || storedTitle === DEFAULT_HELP_CENTER_CONFIG.homepageTitle
      ? word({ id: 'portal.hc.home.title', defaultMessage: 'How can we help?' })
      : storedTitle
  const storedDescription = config?.homepageDescription
  const description =
    storedDescription == null
      ? word({
          id: 'portal.hc.home.description',
          defaultMessage:
            'Search our guides or ask AI for an instant answer. Real answers, fast, no ticket required.',
        })
      : storedDescription === DEFAULT_HELP_CENTER_CONFIG.homepageDescription
        ? word({
            id: 'portal.hc.home.localeDescription',
            defaultMessage: 'Search our knowledge base or browse by category',
          })
        : storedDescription
  return { title, description }
}
