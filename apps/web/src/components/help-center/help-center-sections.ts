import { cn } from '@/lib/shared/utils'
import type { PageChoices } from '@/lib/shared/design/page-choices'

const FADE_IN = 'animate-in fade-in duration-300 fill-mode-backwards'

/**
 * The help center home's topics. On the design engine it spans the page's
 * width and sits as far under the title as every page's content does;
 * outside it, it is as it always was.
 */
export function topicsSectionClass(
  designTitles: boolean,
  topics: PageChoices['help']['topics']
): string {
  if (designTitles)
    return cn(
      'mx-auto w-full max-w-[var(--qb-page-max,72rem)] px-4 pb-16 pt-8 sm:px-6 [[data-qb-page-titles=band]_&]:pt-10',
      FADE_IN
    )
  return cn(
    'mx-auto max-w-[var(--qb-page-max,72rem)] px-4 pb-16 pt-2 sm:px-6 [[data-qb-page-titles=band]_&]:pt-10',
    FADE_IN,
    // A list has no columns to stretch it across the page.
    topics === 'list' && 'w-full'
  )
}

/** The popular articles: as wide as the topics on the design engine. */
export function popularSectionClass(designTitles: boolean): string {
  return designTitles
    ? 'mx-auto w-full max-w-[var(--qb-page-max,72rem)] px-4 pb-20 sm:px-6'
    : 'mx-auto max-w-6xl px-4 pb-20 sm:px-6'
}
