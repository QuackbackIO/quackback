import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { onShipMoment } from '@/lib/client/ship-moment'
import { GITHUB_REPO_URL } from '@/lib/shared/github-star-prompt'
import {
  getStarPromptFn,
  markStarPromptShownFn,
  type StarPromptState,
} from '@/lib/server/functions/github-star-prompt'

const STAR_PROMPT_QUERY_KEY = ['github-star-prompt'] as const
const SHOW_AFTER_MS = 2000
const DIALOG_POLL_MS = 1000

/** A note from the founder, so the photo goes with a name. Proper nouns stay untranslated. */
function Byline({ size }: { size: 'card' | 'row' }) {
  const avatar = size === 'card' ? 'size-9' : 'size-8'
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <img
        src="/founder.webp"
        alt=""
        width={36}
        height={36}
        className={`${avatar} shrink-0 rounded-full bg-muted object-cover`}
      />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-sm font-medium">James</span>
        <span className="text-xs text-muted-foreground">
          <FormattedMessage id="admin.starPrompt.founder" defaultMessage="Founder of Quackback" />
        </span>
      </div>
    </div>
  )
}

/** Drawn inline: the shared icon would split into a file of its own that the inbox then loads. */
function StarButton({ stars, onClick }: { stars: number | null; onClick: () => void }) {
  const intl = useIntl()
  return (
    <Button asChild size="sm">
      <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="size-3.5 text-amber-400"
        >
          <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" />
        </svg>
        <FormattedMessage id="admin.starPrompt.star" defaultMessage="Star on GitHub" />
        {stars !== null && (
          <span className="ms-1 border-s border-current/30 ps-2 tabular-nums opacity-70">
            {intl.formatNumber(stars)}
          </span>
        )}
      </a>
    </Button>
  )
}

function NoThanks({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <FormattedMessage id="admin.starPrompt.noThanks" defaultMessage="No thanks" />
    </Button>
  )
}

type Claim = 'claimed' | 'taken' | 'failed'

/**
 * Claim the prompt on the server as it appears: only the first claim for this
 * person wins, so a second tab that raced it hides its copy again. Once
 * settled either way, the cached answer is cleared so this visit cannot ask
 * again.
 */
async function claimPrompt(queryClient: QueryClient): Promise<Claim> {
  try {
    const { claimed } = await markStarPromptShownFn()
    queryClient.setQueryData<StarPromptState>(STAR_PROMPT_QUERY_KEY, { stage: null, stars: null })
    return claimed ? 'claimed' : 'taken'
  } catch {
    return 'failed'
  }
}

function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}

/**
 * The one-time GitHub star card for self-hosted teams. Mounted by the gate
 * after a ship moment (a post marked complete, a changelog entry published),
 * it lets the success toast land and appears once in the corner without
 * blocking work. A ship moment it cannot show for is retried on the next.
 * It is recorded as shown the moment it appears, so every way of closing it,
 * leaving the page included, is final.
 */
export function GithubStarPromptCard() {
  const queryClient = useQueryClient()
  const [state, setState] = useState<StarPromptState | null>(null)
  const settled = useRef(false)
  const pending = useRef(false)

  useEffect(() => {
    // Leaving before the card appears cancels it, so the one ask is never used up unseen.
    let alive = true
    let timer: number | undefined
    const attempt = () => {
      if (settled.current || pending.current) return
      pending.current = true
      const show = async () => {
        if (!alive) return
        if (dialogOpen()) {
          timer = window.setTimeout(show, DIALOG_POLL_MS)
          return
        }
        try {
          const next = await queryClient.fetchQuery({
            queryKey: STAR_PROMPT_QUERY_KEY,
            queryFn: () => getStarPromptFn(),
            staleTime: 60 * 60 * 1000,
          })
          if (!next.stage || settled.current || !alive) return
          settled.current = true
          setState(next)
        } catch {
          // Nothing to show; the next ship moment may try again.
        } finally {
          pending.current = false
        }
      }
      timer = window.setTimeout(show, SHOW_AFTER_MS)
    }
    // The gate mounts this card because something just shipped.
    attempt()
    const stopListening = onShipMoment(attempt)
    return () => {
      alive = false
      window.clearTimeout(timer)
      pending.current = false
      stopListening()
    }
  }, [queryClient])

  const close = useCallback(() => setState(null), [])

  // Claimed once it is on screen, so leaving mid-request never uses it up unseen.
  const claimed = useRef(false)
  useEffect(() => {
    if (!state || claimed.current) return
    claimed.current = true
    void claimPrompt(queryClient).then((claim) => {
      if (claim === 'taken') setState(null)
    })
  }, [state, queryClient])

  useEffect(() => {
    if (!state) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state, close])

  const intl = useIntl()
  if (!state) return null
  return (
    <aside
      aria-live="polite"
      aria-label={intl.formatMessage({
        id: 'admin.starPrompt.label',
        defaultMessage: 'A note from the founder',
      })}
      className="fixed end-4 bottom-24 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-panel border border-border bg-popover p-4 text-popover-foreground shadow-lg [--ring:var(--muted-foreground)]"
    >
      <div className="flex items-start justify-between gap-2">
        <Byline size="card" />
        <button
          type="button"
          onClick={close}
          className="-me-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={intl.formatMessage({ id: 'ui.close', defaultMessage: 'Close' })}
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
      <p className="text-sm leading-relaxed">
        <FormattedMessage
          id="admin.starPrompt.body"
          defaultMessage="Thanks for using Quackback. A star on GitHub helps other teams find it, and it only takes a click."
        />
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <StarButton stars={state.stars} onClick={close} />
        <NoThanks onClick={close} />
      </div>
    </aside>
  )
}

/**
 * The same one-time ask as a quiet row on Home, for someone the card never
 * reached: their gates have been open for a month without a ship moment.
 */
export function HomeGithubStarPrompt() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: STAR_PROMPT_QUERY_KEY,
    queryFn: () => getStarPromptFn(),
    staleTime: 60 * 60 * 1000,
  })
  const [closed, setClosed] = useState(false)
  // Held for this mount: claiming clears the cached answer, which would otherwise hide the row at once.
  const [shown, setShown] = useState<StarPromptState | null>(null)
  const claiming = useRef(false)

  useEffect(() => {
    if (claiming.current || data?.stage !== 'home') return
    claiming.current = true
    setShown(data)
  }, [data])

  // Claimed once it is on screen, so leaving mid-request never uses it up unseen.
  const claimed = useRef(false)
  useEffect(() => {
    if (!shown || claimed.current) return
    claimed.current = true
    void claimPrompt(queryClient).then((claim) => {
      if (claim === 'taken') setClosed(true)
    })
  }, [shown, queryClient])

  if (!shown || closed) return null
  const close = () => setClosed(true)
  return (
    <section
      aria-labelledby="home-star-prompt"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-panel border border-border bg-card px-5 py-4 [--ring:var(--muted-foreground)]"
    >
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-2">
        <Byline size="row" />
        <p id="home-star-prompt" className="text-sm">
          <FormattedMessage
            id="admin.starPrompt.homeBody"
            defaultMessage="Thanks for using Quackback. A star on GitHub helps other teams find it."
          />
        </p>
      </div>
      <div className="flex items-center gap-2">
        <NoThanks onClick={close} />
        <StarButton stars={shown.stars} onClick={close} />
      </div>
    </section>
  )
}
