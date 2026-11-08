import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Link, useRouteContext } from '@tanstack/react-router'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { textForLocale } from '@/components/public/portal-band'
import { drawnButtonTo, type ButtonTo } from '@/lib/shared/design/main-action'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { HomeComposer } from './home-blocks'
import { homeMessages } from './home-messages'

type Home = PortalDesign['pages']['home']

/** The help search in Home's hero, with Ask AI where the help centre offers it. */
export function HeroSearch() {
  const askAiEnabled = useRouteContext({
    from: '__root__',
    select: (context) => !!context.settings?.featureFlags?.helpCenter,
  })
  return <HelpCenterHeroSearch askAiEnabled={askAiEnabled} size="hero" />
}

/** The hero's buttons: the brand's call to action, and a quiet one beside it. */
const BUTTON_CLASS = {
  main: 'inline-flex items-center rounded-[var(--qb-radius-button,999px)] bg-[var(--qb-action-bg,var(--primary))] px-5 py-2.5 text-sm font-semibold text-[var(--qb-action-ink,var(--primary-foreground))] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  quiet:
    'inline-flex items-center rounded-[var(--qb-radius-button,999px)] border border-[color-mix(in_srgb,var(--qb-band-ink)_28%,transparent)] px-5 py-2.5 text-sm font-semibold text-[var(--qb-band-ink)] hover:bg-[color-mix(in_srgb,var(--qb-band-ink)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
}

/** Each place's usual words, and the page each goes to other than the composer. */
const BUTTON_WORDS = {
  composer: homeMessages.heroWritePost,
  roadmap: homeMessages.heroSeeRoadmap,
  help: homeMessages.helpAll,
  support: homeMessages.contactStart,
} as const
const BUTTON_PATHS = { roadmap: '/roadmap', help: '/hc', support: '/support' } as const

/**
 * Home's call to action: one button that opens the composer in place or goes
 * to the roadmap, help or support, in the design's own words (edited on the page itself), and
 * a quiet second going to the other where the design asks for it and that
 * page is on. Once the composer opens it takes their place; Cancel gives
 * them back.
 */
export function HeroButtons({ home, gates }: { home: Home; gates: PortalPageGates }) {
  const intl = useIntl()
  const [composing, setComposing] = useState(false)
  const to = drawnButtonTo(home, gates)
  if (!to) return null
  if (composing)
    return (
      <div className="basis-full text-left">
        <HomeComposer inBand startOpen onClose={() => setComposing(false)} />
      </div>
    )
  const other: ButtonTo = to === 'composer' ? 'roadmap' : 'composer'
  const otherOn = other === 'roadmap' ? gates.roadmap : gates.feedback
  const words = (going: ButtonTo, stored: Record<string, string> | undefined) =>
    textForLocale(stored, intl.locale) || intl.formatMessage(BUTTON_WORDS[going])
  const button = (going: ButtonTo, main: boolean) => {
    const label = (
      <span data-qb-words={main ? 'home.button' : 'home.secondButton'}>
        {words(going, main ? home.button?.label : home.button?.secondLabel)}
      </span>
    )
    const shared = {
      'data-qb-label': '',
      'data-qb-action': main ? '' : undefined,
      className: main ? BUTTON_CLASS.main : BUTTON_CLASS.quiet,
    }
    return going !== 'composer' ? (
      <Link to={BUTTON_PATHS[going]} {...shared}>
        {label}
      </Link>
    ) : (
      <button type="button" onClick={() => setComposing(true)} {...shared}>
        {label}
      </button>
    )
  }
  return (
    <>
      {button(to, true)}
      {home.button?.second && otherOn && button(other, false)}
    </>
  )
}
