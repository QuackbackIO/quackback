import { useId, type ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { StyleElement } from '@/lib/shared/design/style-tokens'
import { HomeLayoutPicker } from './home-layout-picker'
import {
  PropertiesPanel,
  PropertyRow,
  PropertySection,
  PropertyTiles,
  type Crumb,
} from './properties/properties-panel'
import { ScopeLine } from './properties/scope-line'
import { SummaryRow } from './properties/summary-row'
import { STYLE_CHOICES, WORDS } from './properties/words'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** The parts the inspector has panels for. */
export type InspectorPart = 'welcome' | 'feed' | 'filters' | 'home'

/** What a change in a section reaches, said once at its top. */
function Reach({ phrase }: { phrase: string }) {
  return (
    <ScopeLine
      one={phrase}
      widest={{ id: 'here', phrase }}
      narrower={[]}
      value="here"
      onChange={() => {}}
      className="pb-1"
    />
  )
}

/** What a post card shows besides its title and votes, each with its full name for a reader. */
const CARD_FIELDS = [
  ['excerpt', 'Excerpt', 'Show a line of each post'],
  ['tags', 'Tags', 'Show tags'],
  ['meta', 'Details', 'Show the author, date and comments'],
] as const

/**
 * The panels of the page's other parts, on the properties frame: the
 * welcome message, the feed (what this page sorts by and what each post card
 * shows; how post cards and statuses look is their elements', reached by a
 * summary row), the filters, and how Home starts. Home's blocks are
 * listed in the Blocks menu, and words are edited where the page draws them.
 */
export function Inspector({
  selection,
  crumbs,
  title,
  design,
  update,
  gates,
  onElement,
}: {
  selection: InspectorPart
  crumbs: readonly Crumb[]
  title: string
  design: PortalDesign
  update: NamedUpdate
  gates: PortalPageGates
  /** Picks the element whose look a summary row shows, such as every post card. */
  onElement?: (element: StyleElement) => void
}) {
  const id = useId()
  const { layout } = design
  const frame = (kind: string, children: ReactNode) => (
    <PropertiesPanel crumbs={crumbs} title={title} kind={kind} className="pb-24" data-part-panel="">
      {children}
    </PropertiesPanel>
  )
  switch (selection) {
    case 'welcome':
      return frame(
        WORDS.thisPage,
        <PropertySection>
          <PropertyRow
            label={WORDS.show}
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
    case 'feed':
      return frame(
        'Part',
        <>
          <PropertySection title="Posts">
            <Reach phrase="the feed on this page" />
            <PropertyRow label="Sort">
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
          </PropertySection>
          <PropertySection title="Post cards">
            <Reach phrase="every post card" />
            <SummaryRow
              label="Post card look"
              value={`${STYLE_CHOICES.cards[layout.cards]} · ${STYLE_CHOICES.density[layout.density]}`}
              onOpen={() => onElement?.('postCard')}
            />
            <SummaryRow
              label="Status look"
              value={STYLE_CHOICES.status[layout.status ?? 'colour']}
              onOpen={() => onElement?.('badge')}
            />
            {CARD_FIELDS.map(([field, label, full]) => (
              <PropertyRow key={field} label={label} htmlFor={`${id}-${field}`}>
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
        'Part',
        <PropertySection>
          <Reach phrase="the filters" />
          <PropertyRow label="Side">
            <PropertyTiles
              label="Side"
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
        WORDS.thisPage,
        <PropertySection title="Start from">
          <HomeLayoutPicker design={design} update={update} gates={gates} />
        </PropertySection>
      )
  }
}
