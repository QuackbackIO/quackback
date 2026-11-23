import { useIntl } from 'react-intl'
import { usePreviewHelpCenter } from '@/components/public/preview-draft-context'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'
import { landingCopy, type LandingConfig } from './help-center-landing-copy'

/**
 * The landing copy in the page's language, with the Customise page's unsaved
 * title and description over the saved ones in its preview.
 *
 * Its own module: the route's `head` reads `landingCopy`, which puts that
 * module in every page's script, and the preview draft does not belong there.
 */
export function useHelpCenterLandingCopy(config: HelpCenterConfig | null | undefined) {
  const intl = useIntl()
  const draft = usePreviewHelpCenter()
  const merged: Partial<LandingConfig> | null | undefined = draft
    ? {
        homepageTitle: draft.homepageTitle ?? config?.homepageTitle,
        homepageDescription: draft.homepageDescription ?? config?.homepageDescription,
      }
    : config
  return landingCopy(merged, (copy) => intl.formatMessage(copy))
}
