/**
 * MentionHoverCardOverlay
 *
 * Hover-card layer for `.mention` chips rendered inside an inner HTML
 * surface (`RichTextContent`'s `dangerouslySetInnerHTML`). We can't attach
 * a Radix `HoverCardTrigger` directly to each chip, so this wrapper uses
 * event delegation on the container and a single Radix `Popover` anchored
 * to a fixed-position ghost element sized to the currently-hovered chip's
 * rect.
 *
 * Key behaviours:
 *   - 150ms delay before showing (avoids flicker on quick mouse-overs)
 *   - 200ms grace period after mouseleave before hiding
 *   - Re-measures the anchor rect on scroll + resize while a chip is hovered
 *   - 404 from the principal-card endpoint (deleted principal) suppresses
 *     the popover; the chip falls back to plain text
 *   - Module-level cache with a 5-minute TTL so re-hovering the same chip
 *     skips the fetch. The component is rendered inside leaf renderers
 *     (PostContent, CommentContent) that don't always have a
 *     QueryClientProvider in the tree, so we keep it dependency-free
 *     instead of relying on react-query.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { CheckBadgeIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Avatar } from '@/components/ui/avatar'
import { isTeamMember, type Role } from '@/lib/shared/roles'
import type { SettingsBrandingData } from '@/lib/server/domains/settings/settings.types'

interface PrincipalCard {
  principalId: string
  displayName: string
  avatarUrl: string | null
  role: Role
  joinedAt: string
}

type CacheEntry =
  | { state: 'pending'; promise: Promise<PrincipalCard | null>; fetchedAt: number }
  | { state: 'ok'; card: PrincipalCard; fetchedAt: number }
  | { state: 'missing'; fetchedAt: number }

const HOVER_OPEN_DELAY_MS = 150
const HOVER_CLOSE_DELAY_MS = 200
const CARD_STALE_MS = 5 * 60 * 1000

// Module-level cache shared by every overlay instance. Survives unmounts so
// re-hovering a chip after navigation doesn't re-fetch.
const cardCache = new Map<string, CacheEntry>()

function getCachedEntry(principalId: string): CacheEntry | null {
  const entry = cardCache.get(principalId)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > CARD_STALE_MS) {
    cardCache.delete(principalId)
    return null
  }
  return entry
}

async function fetchPrincipalCard(principalId: string): Promise<PrincipalCard | null> {
  const res = await fetch(`/api/v1/users/${principalId}/card`, { credentials: 'include' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('lookup failed')
  return (await res.json()) as PrincipalCard
}

/**
 * Load + cache a card. Concurrent calls for the same principal share one
 * in-flight promise so a quick mouse jiggle doesn't kick off duplicate
 * requests.
 */
function loadCard(principalId: string): Promise<PrincipalCard | null> {
  const existing = getCachedEntry(principalId)
  if (existing?.state === 'ok') return Promise.resolve(existing.card)
  if (existing?.state === 'missing') return Promise.resolve(null)
  if (existing?.state === 'pending') return existing.promise

  const promise = fetchPrincipalCard(principalId)
    .then((card) => {
      cardCache.set(
        principalId,
        card
          ? { state: 'ok', card, fetchedAt: Date.now() }
          : { state: 'missing', fetchedAt: Date.now() }
      )
      return card
    })
    .catch((err) => {
      // Network / 5xx — don't cache; let the next hover try again.
      cardCache.delete(principalId)
      throw err
    })
  cardCache.set(principalId, { state: 'pending', promise, fetchedAt: Date.now() })
  return promise
}

interface MentionHoverCardOverlayProps {
  children: ReactNode
  className?: string
}

export function MentionHoverCardOverlay({ children, className }: MentionHoverCardOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ rect: DOMRect; principalId: string } | null>(null)
  const ctx = useRouteContext({ from: '__root__' }) as {
    settings?: { brandingData?: SettingsBrandingData; name?: string | null }
  }
  const branding = ctx.settings?.brandingData
  const teamBadgeLogoUrl = branding?.logoUrl ?? null
  const teamBadgeLabel = branding?.name ?? ctx.settings?.name ?? 'Team'
  const [card, setCard] = useState<PrincipalCard | null>(null)
  const [isMissing, setIsMissing] = useState(false)

  // Whenever the anchor changes, kick off (or read from cache) the card
  // load. We track the current principalId in a ref so a late-resolving
  // fetch for a previously-hovered chip can't overwrite state for the
  // chip we're now on.
  const activePrincipalRef = useRef<string | null>(null)
  useEffect(() => {
    activePrincipalRef.current = anchor?.principalId ?? null
    if (!anchor) {
      setCard(null)
      setIsMissing(false)
      return
    }

    const principalId = anchor.principalId
    const cached = getCachedEntry(principalId)
    if (cached?.state === 'ok') {
      setCard(cached.card)
      setIsMissing(false)
      return
    }
    if (cached?.state === 'missing') {
      setCard(null)
      setIsMissing(true)
      return
    }

    // Pending or absent → fire a load and apply only if still the active chip.
    setCard(null)
    setIsMissing(false)
    loadCard(principalId)
      .then((result) => {
        if (activePrincipalRef.current !== principalId) return
        if (result) {
          setCard(result)
          setIsMissing(false)
        } else {
          setCard(null)
          setIsMissing(true)
        }
      })
      .catch(() => {
        if (activePrincipalRef.current !== principalId) return
        setCard(null)
        setIsMissing(true)
      })
  }, [anchor])

  // Track the currently-hovered chip so scroll/resize listeners can
  // re-measure its rect even while React batches state updates.
  const hoveredChipRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let openTimer: ReturnType<typeof setTimeout> | null = null
    let closeTimer: ReturnType<typeof setTimeout> | null = null

    function clearTimers() {
      if (openTimer) {
        clearTimeout(openTimer)
        openTimer = null
      }
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = null
      }
    }

    function onEnter(e: Event) {
      const target = e.target as HTMLElement | null
      if (!target || typeof target.closest !== 'function') return
      const chip = target.closest('.mention') as HTMLElement | null
      if (!chip || !container!.contains(chip)) return
      const principalId = chip.dataset.principalId
      if (!principalId) return
      hoveredChipRef.current = chip
      clearTimers()
      openTimer = setTimeout(() => {
        setAnchor({ rect: chip.getBoundingClientRect(), principalId })
      }, HOVER_OPEN_DELAY_MS)
    }

    function onLeave(e: Event) {
      const target = e.target as HTMLElement | null
      if (!target || typeof target.closest !== 'function') return
      const chip = target.closest('.mention')
      if (!chip) return
      clearTimers()
      closeTimer = setTimeout(() => {
        hoveredChipRef.current = null
        setAnchor(null)
      }, HOVER_CLOSE_DELAY_MS)
    }

    // Keep the popover glued to the chip when the page or an ancestor
    // scrolls. `capture: true` catches scrolls on any nested scroll
    // container (e.g. modals using scroll-area).
    function reposition() {
      const chip = hoveredChipRef.current
      if (!chip) return
      const principalId = chip.dataset.principalId
      if (!principalId) return
      setAnchor({ rect: chip.getBoundingClientRect(), principalId })
    }

    container.addEventListener('mouseenter', onEnter, true)
    container.addEventListener('mouseleave', onLeave, true)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)

    return () => {
      container.removeEventListener('mouseenter', onEnter, true)
      container.removeEventListener('mouseleave', onLeave, true)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      clearTimers()
    }
  }, [])

  // Deleted principal → suppress the popover entirely so the chip is just
  // plain `@name` text from the rendered HTML.
  const open = !!anchor && !isMissing && !!card

  return (
    <div ref={containerRef} className={className} data-slot="mention-hover-overlay">
      {children}
      <Popover open={open}>
        <PopoverAnchor asChild>
          <span
            aria-hidden
            style={{
              position: 'fixed',
              left: anchor?.rect.left ?? 0,
              top: anchor?.rect.top ?? 0,
              width: anchor?.rect.width ?? 0,
              height: anchor?.rect.height ?? 0,
              pointerEvents: 'none',
            }}
          />
        </PopoverAnchor>
        <PopoverContent className="w-64 p-3" align="start" sideOffset={6}>
          {card ? (
            <div className="flex items-start gap-3">
              <Avatar src={card.avatarUrl} name={card.displayName} className="size-10" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground truncate">
                    {card.displayName}
                  </span>
                  {isTeamMember(card.role) && (
                    <span
                      className="inline-flex items-center justify-center h-5 w-5 rounded-md bg-primary/15 text-primary shrink-0"
                      aria-label={`${teamBadgeLabel} Member`}
                      title={`${teamBadgeLabel} Member`}
                    >
                      {teamBadgeLogoUrl ? (
                        <img
                          src={teamBadgeLogoUrl}
                          alt=""
                          className="h-4 w-4 rounded-sm object-contain"
                        />
                      ) : (
                        <CheckBadgeIcon className="h-4 w-4" />
                      )}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground/70 mt-1">
                  Joined{' '}
                  {new Date(card.joinedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}

/**
 * Test-only: drop the in-memory card cache between tests so state doesn't
 * bleed across cases. Not exported from any barrel.
 */
export function __resetMentionHoverCardCacheForTests() {
  cardCache.clear()
}
