import { useId, type ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { HomeLayoutPicker } from './home-layout-picker'
import {
  PropertiesPanel,
  PropertyRow,
  PropertySection,
  PropertyTiles,
  type Crumb,
} from './properties/properties-panel'
import { ReachNote } from './properties/scope-line'
import { STYLE_CHOICES, WORDS } from './properties/words'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** The parts the inspector has panels for. */
export type InspectorPart = 'welcome' | 'feed' | 'filters' | 'home'

const capital = (value: string) => value[0]!.toUpperCase() + value.slice(1)

/** What a change in a section reaches, said once at its top. */
function Reach({ phrase }: { phrase: string }) {
  return <ReachNote phrase={phrase} className="pb-1" />
}

/** What a post card shows besides its title and votes, each with its full name for a reader. */
const CARD_FIELDS = [
  ['excerpt', 'Excerpt', 'Show a line of each post'],
  ['tags', 'Tags', 'Show tags'],
  ['meta', 'Details', 'Show the author, date and comments'],
] as const

/**
 * The panels of the page's other parts, on the properties frame: the
 * welcome message, the feed (what this page sorts by, apart from how every
 * post card looks), the filters, and how Home starts. Home's blocks are
 * listed in the Blocks menu, and words are edited where the page draws them.
 */
export function Inspector({
  selection,
  crumbs,
  title,
  design,
  update,
  gates,
}: {
  selection: InspectorPart
  crumbs: readonly Crumb[]
  title: string
  design: PortalDesign
  update: NamedUpdate
  gates: PortalPageGates
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
            <PropertyRow label="Cards">
              <PropertyTiles
                label="Cards"
                value={layout.cards}
                options={(['bordered', 'raised', 'list', 'filled'] as const).map(
                  (cards) => [cards, STYLE_CHOICES.cards[cards]] as const
                )}
                onChange={(cards) => update((draft) => void (draft.layout.cards = cards), 'Cards')}
              />
            </PropertyRow>
            {layout.cards === 'raised' && (
              <PropertyRow label="Shadow">
                <PropertyTiles
                  label="Shadow"
                  value={
                    design.tune?.card?.shadow && design.tune.card.shadow !== 'none'
                      ? design.tune.card.shadow
                      : 'lifted'
                  }
                  options={(['soft', 'lifted', 'floating', 'deep'] as const).map(
                    (shadow) => [shadow, capital(shadow)] as const
                  )}
                  onChange={(shadow) =>
                    update(
                      (draft) => void ((draft.tune ??= {}).card = { ...draft.tune.card, shadow }),
                      'Card shadow'
                    )
                  }
                />
              </PropertyRow>
            )}
            <PropertyRow label="Density">
              <PropertyTiles
                label="Density"
                value={layout.density}
                options={(['compact', 'comfortable', 'spacious'] as const).map(
                  (density) => [density, STYLE_CHOICES.density[density]] as const
                )}
                onChange={(density) =>
                  update((draft) => void (draft.layout.density = density), 'Density')
                }
              />
            </PropertyRow>
            <PropertyRow label="Status">
              <PropertyTiles
                label="Status"
                value={layout.status ?? 'colour'}
                options={(['colour', 'ink', 'pill', 'brand'] as const)
                  .filter(
                    (status) => status !== 'brand' || (design.brand.logoColours?.length ?? 0) > 1
                  )
                  .map((status) => [status, STYLE_CHOICES.status[status]] as const)}
                onChange={(status) =>
                  update((draft) => void (draft.layout.status = status), 'Status')
                }
              />
            </PropertyRow>
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
        <PropertySection title="Start from">
          <HomeLayoutPicker design={design} update={update} gates={gates} />
        </PropertySection>
      )
  }
}
