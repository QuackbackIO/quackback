import { useId, type ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { StyleElement } from '@/lib/shared/design/style-tokens'
import { ComposerWords, EmptyFeedWords } from './feed-words'
import { FIND } from './find-rows'
import { HomeLayoutPicker } from './home-layout-picker'
import {
  PropertiesPanel,
  PropertyRow,
  PropertySection,
  PropertyTiles,
  type Crumb,
} from './properties/properties-panel'
import { ReachNote } from './properties/scope-line'
import { SummaryRow } from './properties/summary-row'
import { STYLE_CHOICES } from './properties/words'
import { useBlockSources } from './use-block-sources'
import { layoutValue } from '@/lib/shared/design/defaults'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** The parts the inspector has panels for. */
export type InspectorPart = 'welcome' | 'composer' | 'feed' | 'filters' | 'home'

/** What a change in a section reaches, said once at its top. */
function Reach({ phrase }: { phrase: string }) {
  return <ReachNote phrase={phrase} className="pb-1" />
}

/** What a post card shows besides its title and votes, each with its full name for a reader. */
const CARD_FIELDS = [
  ['excerpt', FIND.excerpt, 'Show a line of each post'],
  ['tags', FIND.tags, 'Show tags'],
  ['meta', FIND.details, 'Show the author, date and comments'],
] as const

/**
 * The panels of the page's other parts, on the properties frame: the
 * welcome message, the composer's words, the feed (what this page sorts by,
 * what each post card shows and its empty title; how post cards and statuses
 * look is their elements', reached by a summary row), the filters, and how
 * Home starts. Home's blocks are
 * listed in the Blocks menu, and words are edited where the page draws them.
 */
export function Inspector({
  selection,
  crumbs,
  title,
  design,
  update,
  gates,
  locale = 'en',
  onElement,
}: {
  selection: InspectorPart
  crumbs: readonly Crumb[]
  title: string
  design: PortalDesign
  update: NamedUpdate
  gates: PortalPageGates
  /** The language the canvas shows, whose words the rows show and edit. */
  locale?: string
  /** Picks the element whose look a summary row shows, such as every post card. */
  onElement?: (element: StyleElement) => void
}) {
  const id = useId()
  const { layout } = design
  const frame = (children: ReactNode) => (
    <PropertiesPanel crumbs={crumbs} title={title} className="pb-24" data-part-panel="">
      {children}
    </PropertiesPanel>
  )
  switch (selection) {
    case 'welcome':
      return frame(
        <PropertySection>
          <PropertyRow
            label={FIND.welcome.label}
            find={FIND.welcome.id}
            htmlFor={`${id}-welcome`}
            source="Its words are edited on the page"
          >
            <Switch
              id={`${id}-welcome`}
              aria-label="Show the welcome message"
              checked={design.pages.feedback.welcome.show}
              onCheckedChange={(show) =>
                update(
                  (draft) => void (draft.pages.feedback.welcome.show = show),
                  'Welcome message'
                )
              }
            />
          </PropertyRow>
        </PropertySection>
      )
    case 'composer':
      return frame(<ComposerWords design={design} update={update} locale={locale} />)
    case 'feed':
      return frame(
        <>
          <PropertySection title="Posts">
            <Reach phrase="the feed on this page" />
            <PropertyRow label={FIND.sort.label} find={FIND.sort.id}>
              <PropertyTiles
                label="Default sort"
                value={design.pages.feedback.defaultSort}
                options={[
                  ['trending', 'Trending'],
                  ['top', 'Top'],
                  ['new', 'New'],
                ]}
                onChange={(sort) =>
                  update((draft) => void (draft.pages.feedback.defaultSort = sort), 'Default sort')
                }
              />
            </PropertyRow>
            <OpensOnRow design={design} update={update} />
          </PropertySection>
          <EmptyFeedWords design={design} update={update} locale={locale} />
          <PropertySection title="Post cards">
            <Reach phrase="every post card" />
            <SummaryRow
              label="Post card look"
              value={`${STYLE_CHOICES.cards[layout.cards]} · ${STYLE_CHOICES.density[layout.density]}`}
              onOpen={() => onElement?.('postCard')}
            />
            <SummaryRow
              label="Status look"
              value={STYLE_CHOICES.status[layoutValue(layout, 'status')]}
              onOpen={() => onElement?.('badge')}
            />
            {CARD_FIELDS.map(([field, row, full]) => (
              <PropertyRow key={field} label={row.label} find={row.id} htmlFor={`${id}-${field}`}>
                <Switch
                  id={`${id}-${field}`}
                  aria-label={full}
                  checked={!layout.postCardHides?.includes(field)}
                  onCheckedChange={(on) =>
                    update((draft) => {
                      const hides = (draft.layout.postCardHides ?? []).filter((f) => f !== field)
                      if (!on) hides.push(field)
                      if (hides.length) draft.layout.postCardHides = hides
                      else delete draft.layout.postCardHides
                    }, 'Post cards')
                  }
                />
              </PropertyRow>
            ))}
          </PropertySection>
        </>
      )
    case 'filters':
      return frame(
        <PropertySection>
          <Reach phrase="the filters" />
          <PropertyRow label={FIND.filtersSide.label} find={FIND.filtersSide.id}>
            <PropertyTiles
              label={FIND.filtersSide.label}
              value={layout.filters}
              options={[
                ['end', 'Right'],
                ['start', 'Left'],
              ]}
              onChange={(filters) =>
                update((draft) => void (draft.layout.filters = filters), 'Filters')
              }
            />
          </PropertyRow>
        </PropertySection>
      )
    case 'home':
      return frame(
        <PropertySection title="Start from">
          <HomeLayoutPicker design={design} update={update} gates={gates} />
        </PropertySection>
      )
  }
}

/** Stands for every board in the select, which cannot hold an empty value. */
const ALL_BOARDS = 'all'

/** The board the feed opens on when the address names none: every board, or one. */
function OpensOnRow({ design, update }: { design: PortalDesign; update: NamedUpdate }) {
  const id = useId()
  const { boards } = useBlockSources()
  const stored = design.pages.feedback.openOn
  // A board set before it was hidden stays offered, so the select still says it.
  const shown =
    stored && !boards.some(([board]) => board === stored)
      ? [...boards, [stored, 'Hidden board'] as const]
      : boards
  const choose = (picked: string) =>
    update((draft) => {
      if (picked === ALL_BOARDS) delete draft.pages.feedback.openOn
      else draft.pages.feedback.openOn = picked as typeof stored
    }, FIND.opensOn.label)
  return (
    <PropertyRow
      label={FIND.opensOn.label}
      find={FIND.opensOn.id}
      htmlFor={id}
      set={stored !== undefined}
      onReset={() => choose(ALL_BOARDS)}
    >
      <Select value={stored ?? ALL_BOARDS} onValueChange={choose}>
        <SelectTrigger
          id={id}
          size="sm"
          aria-label={FIND.opensOn.label}
          className="h-7 w-full text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_BOARDS}>All boards</SelectItem>
          {shown.map(([board, name]) => (
            <SelectItem key={board} value={board}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PropertyRow>
  )
}
