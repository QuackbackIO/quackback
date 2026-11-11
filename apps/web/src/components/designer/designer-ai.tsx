import { useState } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ChevronDoubleLeftIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { AskAiPanel, type ShowChange } from '@/components/admin/settings/appearance/ask-ai-panel'
import {
  DesignComposer,
  type ChatContext,
} from '@/components/admin/settings/appearance/design-composer'
import type { Update } from '@/components/admin/settings/appearance/design-update'
import type { useDesignAi } from '@/components/admin/settings/appearance/use-design-ai'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import type { AiElementPick, DesignAiScope } from '@/lib/shared/design/apply-changes'
import type { DesignerPage, Selection } from '@/lib/shared/design/outline'
import { reachChoices, type AiReach } from '@/lib/shared/design/ai-reach'
import { heroOf, writeHero } from '@/lib/shared/design/hero'
import { isMenuSelection } from '@/lib/shared/design/menu'
import { siteCaptureUsageFn } from '@/lib/server/functions/site-capture'
import { aiStarters, hasMatched, MATCH_HINT, MATCH_STARTER } from '@/lib/shared/design/ai-starters'
import { websiteIn, type UnmatchedFont } from '@/lib/shared/design/match-brand'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { BrandLogoCard } from './brand-logo-card'

/** The part of the design a request about each selection may change. */
export function aiScopeOf(selection: Selection | null): {
  scope: DesignAiScope
  blockId?: string
} {
  if (!selection) return { scope: 'site' }
  if (selection.startsWith('block-')) return { scope: 'home', blockId: selection.slice(6) }
  // An item of the menu is in the header.
  if (isMenuSelection(selection)) return { scope: 'header' }
  // The brand kit and the styles reach the brand.
  if (selection.startsWith('site:')) return { scope: 'brand' }
  const scopes: Record<string, DesignAiScope> = {
    site: 'brand',
    header: 'header',
    logo: 'logo',
    // The AI's scope for the hero keeps its older name, band.
    hero: 'band',
    welcome: 'welcome',
    // The composer's words are the feed's.
    composer: 'feed',
    feed: 'feed',
    filters: 'filters',
    home: 'home',
    entries: 'changelog',
    topics: 'help',
    popular: 'help',
    article: 'help',
    board: 'roadmap',
    vote: 'post',
    details: 'post',
    comments: 'post',
    request: 'support',
  }
  return { scope: scopes[selection] ?? 'site' }
}

/** The id of Ask AI's request box, which "/" focuses. */
export const AI_BOX_ID = 'designer-ai-box'

/** Before the first request: one line, and what to start from for this portal, page and pick. */
function AiEmpty({
  design,
  gates,
  page,
  selection,
  onStarter,
}: {
  design: PortalDesign
  gates?: Partial<PortalPageGates>
  page?: DesignerPage
  selection: Selection | null
  onStarter: (text: string) => void
}) {
  const starters = aiStarters(design, gates, { ...(page ? { page } : {}), selection })
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 py-8 text-center">
      <span className="grid size-10 place-items-center rounded-full border border-border">
        <SparklesIcon className="size-5 text-chrome-active-icon" aria-hidden="true" />
      </span>
      <p className="max-w-60 text-sm font-medium">Ask for a change</p>
      {!hasMatched(design) && (
        <p className="max-w-60 text-xs text-muted-foreground">
          Paste your website or screenshots to match your brand.
        </p>
      )}
      {starters.length > 0 && (
        <ul aria-label="Suggestions" className="mt-2 flex flex-wrap justify-center gap-1.5">
          {starters.map((starter) => (
            <li key={starter}>
              <button
                type="button"
                onClick={() => onStarter(starter)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-ring"
              >
                {starter}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Below this many captures left, a website typed says how many remain. */
const FEW_CAPTURES = 10

/**
 * How many website captures are left this month, once a website is typed
 * and fewer than ten remain; with none left, the capture's own refusal says so.
 */
export function CapturesLeft({ text }: { text: string }) {
  const typed = !!websiteIn(text)
  const usage = useQuery({
    queryKey: ['designer', 'site-capture-usage'],
    queryFn: () => siteCaptureUsageFn(),
    retry: false,
    staleTime: 60_000,
    enabled: typed,
  })
  const left = usage.data?.configured ? usage.data.limit - usage.data.used : null
  if (!typed || left === null || left >= FEW_CAPTURES || left <= 0) return null
  return (
    <p className="mb-2 ps-2 text-xs text-muted-foreground">
      {left === 1 ? '1 website capture' : `${left} website captures`} left this month.
    </p>
  )
}

/**
 * Ask AI in its pane on the left (see AiPane): a plain chat, the
 * conversation scrolling over the request box, which stays at the bottom
 * with the picked block riding along as a chip. A request reaches only the
 * picked part; the chip's X lets it go. Each reply is one undo step.
 */
export function DesignerAi({
  ai,
  draft,
  selection,
  selectionName,
  element = null,
  elementName = null,
  pageName,
  page = 'home',
  update,
  onClearSelection,
  onCollapse,
  gates,
  onFonts,
  show,
}: {
  /** The conversation, kept by the designer so a match made in the inspector joins it. */
  ai: ReturnType<typeof useDesignAi>
  draft: ReturnType<typeof useDesignDraft>
  selection: Selection | null
  /** The selected part's name, for the composer. */
  selectionName: string | null
  /** An element picked inside the selection, which "just this" names. */
  element?: AiElementPick | null
  /** The picked element's own name, "Call to action", which the chip leads with. */
  elementName?: string | null
  /** The page shown, which the picked part is on. */
  pageName: string
  /**
   * The page shown, by its id: the starters keep to it with nothing picked, and
   * a request kept to one page keeps to it.
   */
  page?: DesignerPage
  update: Update
  onClearSelection: () => void
  /** Folds the pane to its rail. */
  onCollapse: () => void
  /** Which pages the workspace has, so a suggestion never asks for one it lacks. */
  gates?: Partial<PortalPageGates>
  /** Opens Theme's Brand kit fonts, with the upload for a font a brand match could not match. */
  onFonts?: (font?: UnmatchedFont) => void
  /** Shows a change on the canvas from its Show changes row. */
  show?: ShowChange
}) {
  const { available } = useSuspenseQuery(portalDesignQueries.aiStatus()).data
  const { scope, blockId } = aiScopeOf(selection)
  const [prefill, setPrefill] = useState<{ text: string; seq: number; hint?: string } | null>(null)
  const fill = (text: string) =>
    setPrefill((was) => ({
      seq: (was?.seq ?? 0) + 1,
      // Match my brand points at the box: the website or screenshots go there.
      ...(text === MATCH_STARTER ? { text: '', hint: MATCH_HINT } : { text }),
    }))
  // How far a request may reach: the panel's own scope first, until another is chosen
  // for this pick on this page.
  const choices = reachChoices(draft.design, { scope, blockId, element }, page, gates)
  const pickKey = `${selection}|${element?.element ?? ''}|${element?.part ?? ''}|${page}`
  const [chosen, setChosen] = useState<{ key: string; reach: AiReach } | null>(null)
  const within: AiReach | undefined =
    chosen?.key === pickKey && choices.some((choice) => choice.reach === chosen.reach)
      ? chosen.reach
      : choices[0]?.reach
  const reach = within
    ? {
        choices,
        value: within,
        onChange: (next: AiReach) => setChosen({ key: pickKey, reach: next }),
      }
    : undefined
  // A block, a section of the page or an item of the menu; never the site's own settings.
  // An element picked inside it leads, with the section it is in beside it.
  const context: ChatContext | null =
    selection && selectionName && selection !== 'site' && !selection.startsWith('site:')
      ? element && elementName
        ? { name: elementName, section: selectionName, page: pageName, ...(reach && { reach }) }
        : { name: selectionName, page: pageName, ...(reach && { reach }) }
      : null
  return (
    <section
      id="designer-ai"
      aria-labelledby="designer-ai-title"
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border ps-4 pe-2">
        <h2 id="designer-ai-title" className="flex items-center gap-1.5 text-sm font-semibold">
          <SparklesIcon className="size-4 text-chrome-active-icon" aria-hidden="true" />
          Ask AI
        </h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ms-auto"
              aria-label="Collapse Ask AI"
              aria-expanded
              aria-controls="designer-ai"
              onClick={onCollapse}
            >
              <ChevronDoubleLeftIcon className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Collapse</TooltipContent>
        </Tooltip>
      </div>
      <div
        role="log"
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {available && ai.turns.length === 0 ? (
          <AiEmpty
            design={draft.design}
            gates={gates}
            page={page}
            selection={selection}
            onStarter={fill}
          />
        ) : (
          <AskAiPanel
            available={available}
            turns={ai.turns}
            busy={ai.busy}
            stage={ai.stage}
            steps={ai.steps}
            design={draft.design}
            update={update}
            {...(show ? { show } : {})}
            renderBrand={(turn, index) =>
              turn.brand && (
                <BrandLogoCard
                  logo={turn.brand}
                  onChange={(next) => void ai.adjustLogo(index, next)}
                />
              )
            }
            onWiden={(text) => {
              onClearSelection()
              void ai.ask(text, 'site')
            }}
            onChip={fill}
            onDirect={({ label, reply, changes }) => {
              ai.record({ role: 'user', text: label })
              ai.record({ role: 'assistant', text: reply, changes })
            }}
            onRecapture={(url) => void ai.recapture(url)}
            {...(onFonts && {
              onUploadFont: (font: UnmatchedFont) => onFonts(font),
              onFonts: () => onFonts(),
            })}
            onHeroPhoto={(image) =>
              update((draft) => writeHero(draft, { ...heroOf(draft), image }, 'image'))
            }
          />
        )}
      </div>
      {available && (
        <div className="shrink-0 p-2">
          <DesignComposer
            id={AI_BOX_ID}
            scope={scope}
            label={blockId && selectionName ? selectionName : undefined}
            context={context}
            busy={ai.busy}
            limited={ai.limited}
            onStop={ai.stop}
            onClearScope={onClearSelection}
            onAsk={(text, images, brand) =>
              // An element picked inside the selection rides along, so "just this" names it,
              // and the chip's reach with it, which the server holds every change to.
              void (context && within
                ? ai.ask(text, scope, images, blockId, brand, element ?? undefined, within)
                : element
                  ? ai.ask(text, scope, images, blockId, brand, element)
                  : ai.ask(text, scope, images, blockId, brand))
            }
            prefill={prefill}
            below={(text) => <CapturesLeft text={text} />}
          />
        </div>
      )}
    </section>
  )
}
