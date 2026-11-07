/**
 * The controls for each part of the portal, shared by Appearance's Sections
 * tab and the designer's inspectors, so the two always edit the same way.
 */
import { inLanguage } from '@/lib/shared/design/labels'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { WelcomeWords } from '@/components/designer/words/welcome-words'
import type { TiptapContent } from '@/lib/shared/db-types'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import { getBandImageUploadUrlFn } from '@/lib/server/functions/uploads'
import {
  setWordsDoc,
  wordsChangeLabel,
  wordsDocOf,
  wordsElsewhere,
  wordsKindOf,
  wordsLimitOf,
  type WordedPage,
} from '@/lib/shared/design/headline-words'
import { WordsField } from '@/components/designer/words/words-field'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { wordsRoles } from '@/lib/shared/design/colour-roles'
import { DesignTiles } from './design-tiles'
import { MenuAlignControls } from './motion-controls'
import {
  StatusDrawing,
  CardsDrawing,
  HeaderDrawing,
  DensityDrawing,
  FiltersDrawing,
  NavDrawing,
  NavTextDrawing,
  ShadowDrawing,
  SortDrawing,
  WidthDrawing,
} from './drawings'

export type Update = (change: (draft: PortalDesign) => void) => void

const capital = (value: string) => value[0].toUpperCase() + value.slice(1)

const STATUS_LABELS: Record<NonNullable<PortalDesign['layout']['status']>, string> = {
  colour: 'Coloured',
  ink: 'Text colour',
  pill: 'Tags',
  brand: 'Logo colours',
}

export const presignBandImage = async (file: File) =>
  getBandImageUploadUrlFn({
    data: { filename: file.name, contentType: file.type, fileSize: file.size },
  })

/** The header: its layout and its menu style. Blending it into the hero is the hero's setting. */
export function HeaderControls({ design, update }: { design: PortalDesign; update: Update }) {
  const { layout } = design
  return (
    <>
      <DesignTiles
        name="design-header"
        label="Layout"
        value={layout.header}
        onChange={(header) => update((draft) => void (draft.layout.header = header))}
        options={DESIGN_OPTIONS.header.map((header) => ({
          value: header,
          label: header === 'centered' ? 'Centred' : capital(header),
          drawing: <HeaderDrawing header={header} />,
        }))}
      />
      <MenuAlignControls design={design} update={update} />
      <MenuStyleControls design={design} update={update} />
    </>
  )
}

/**
 * A page's headline words in one language: its title and its line, edited as
 * the canvas edits them. Selecting words in the title sets them apart (Accent,
 * Highlight or Lighter), one phrase per headline. Each visitor sees their
 * language, else the closest; the other languages show beneath as a hint.
 */
export function HeadlineFields({
  design,
  update,
  page,
  locale,
  labels = { title: 'Headline', subtitle: 'Subtitle' },
  focusTitle = false,
}: {
  design: PortalDesign
  /** Takes the change's name for the builder's undo, such as "Headline: accent". */
  update: (change: (draft: PortalDesign) => void, label?: string) => void
  page: WordedPage
  locale: string
  labels?: { title: string; subtitle: string }
  /** @deprecated The fields take their own ids. */
  idPrefix?: string
  /** Puts the cursor in the headline when the fields appear. */
  focusTitle?: boolean
}) {
  return (
    <>
      {(['title', 'subtitle'] as const).map((part) => {
        const field = { kind: 'page', page, part } as const
        const value = wordsDocOf(design, field, locale)
        return (
          <WordsField
            key={`${page}-${part}-${locale}`}
            label={inLanguage(labels[part], locale)}
            kind={wordsKindOf(field)}
            value={value}
            limit={wordsLimitOf(field)}
            autoFocus={focusTitle && part === 'title'}
            elsewhere={wordsElsewhere(design, field, locale)}
            roles={wordsRoles(design)}
            onChange={(doc) =>
              update(
                (draft) => setWordsDoc(draft, field, locale, doc),
                wordsChangeLabel(field, value, doc)
              )
            }
          />
        )
      })}
    </>
  )
}

/** The welcome message above the feed. */
export function WelcomeControls({ design, update }: { design: PortalDesign; update: Update }) {
  return (
    <>
      <SettingRow
        label="Welcome message"
        htmlFor="design-welcome"
        control={
          <Switch
            id="design-welcome"
            checked={design.pages.feedback.welcome.show}
            onCheckedChange={(show) =>
              update((draft) => void (draft.pages.feedback.welcome.show = show))
            }
          />
        }
      />
      {design.pages.feedback.welcome.show && (
        <WelcomeWords
          label="Welcome words"
          value={design.pages.feedback.welcome.body as TiptapContent}
          roles={wordsRoles(design)}
          onChange={(body) => update((draft) => void (draft.pages.feedback.welcome.body = body))}
        />
      )}
    </>
  )
}

/** The feed: its cards, sort, density and status markers. */
export function FeedControls({ design, update }: { design: PortalDesign; update: Update }) {
  return (
    <>
      <CardStyleControls design={design} update={update} />
      <DesignTiles
        name="design-sort"
        label="Default sort"
        value={design.pages.feedback.defaultSort}
        onChange={(sort) => update((draft) => void (draft.pages.feedback.defaultSort = sort))}
        options={[
          {
            value: 'trending',
            label: 'Trending',
            drawing: <SortDrawing sort="trending" />,
          },
          {
            value: 'top',
            label: 'Top',
            drawing: <SortDrawing sort="top" />,
          },
          {
            value: 'new',
            label: 'New',
            drawing: <SortDrawing sort="new" />,
          },
        ]}
      />
      <StatusControls design={design} update={update} />
      <PostCardFields design={design} update={update} />
    </>
  )
}

/** Which side the filters sit on. */
export function FiltersControls({ design, update }: { design: PortalDesign; update: Update }) {
  const { layout } = design
  return (
    <>
      <DesignTiles
        name="design-filters"
        label="Side"
        value={layout.filters}
        columns={2}
        onChange={(filters) => update((draft) => void (draft.layout.filters = filters))}
        options={[
          { value: 'end', label: 'Right', drawing: <FiltersDrawing filters="end" /> },
          { value: 'start', label: 'Left', drawing: <FiltersDrawing filters="start" /> },
        ]}
      />
    </>
  )
}

/** How wide every page's content runs. */
export function PageWidthControls({ design, update }: { design: PortalDesign; update: Update }) {
  const { layout } = design
  return (
    <>
      <DesignTiles
        name="design-width"
        label="Page width"
        value={layout.width}
        onChange={(width) => update((draft) => void (draft.layout.width = width))}
        options={DESIGN_OPTIONS.width.map((width) => ({
          value: width,
          label: capital(width),
          drawing: <WidthDrawing width={width} />,
        }))}
      />
    </>
  )
}

/** How the menu marks its pages. */
export function MenuStyleControls({ design, update }: { design: PortalDesign; update: Update }) {
  const { layout } = design
  return (
    <>
      <DesignTiles
        name="design-nav"
        label="Menu style"
        value={layout.nav}
        onChange={(nav) => update((draft) => void (draft.layout.nav = nav))}
        options={DESIGN_OPTIONS.nav.map((nav) => ({
          value: nav,
          label: capital(nav),
          drawing: <NavDrawing nav={nav} />,
        }))}
      />
      <DesignTiles
        name="design-nav-text"
        label="Menu text"
        value={layout.navText ?? 'muted'}
        columns={2}
        onChange={(text) => update((draft) => void (draft.layout.navText = text))}
        options={[
          { value: 'muted', label: 'Grey', drawing: <NavTextDrawing text="muted" /> },
          { value: 'ink', label: 'Text colour', drawing: <NavTextDrawing text="ink" /> },
        ]}
      />
    </>
  )
}

/** A raised card's shadow: its exact one, else the raised look's own, lifted. */
const raisedShadow = (design: PortalDesign): 'soft' | 'lifted' | 'floating' | 'deep' => {
  const shadow = design.tune?.card?.shadow
  return shadow && shadow !== 'none' ? shadow : 'lifted'
}

/** Cards’ style and how closely they sit. */
export function CardStyleControls({ design, update }: { design: PortalDesign; update: Update }) {
  const { layout } = design
  return (
    <>
      <DesignTiles
        name="design-cards"
        label="Cards"
        value={layout.cards}
        onChange={(cards) => update((draft) => void (draft.layout.cards = cards))}
        options={DESIGN_OPTIONS.cards.map((cards) => ({
          value: cards,
          label: capital(cards),
          drawing: <CardsDrawing cards={cards} />,
        }))}
      />
      {layout.cards === 'raised' && (
        <DesignTiles
          name="design-card-shadow"
          label="Shadow"
          value={raisedShadow(design)}
          columns={4}
          onChange={(shadow) =>
            update((draft) => void ((draft.tune ??= {}).card = { ...draft.tune.card, shadow }))
          }
          options={(['soft', 'lifted', 'floating', 'deep'] as const).map((shadow) => ({
            value: shadow,
            label: capital(shadow),
            drawing: <ShadowDrawing shadow={shadow} />,
          }))}
        />
      )}
      <DesignTiles
        name="design-density"
        label="Density"
        value={layout.density}
        onChange={(density) => update((draft) => void (draft.layout.density = density))}
        options={DESIGN_OPTIONS.density.map((density) => ({
          value: density,
          label: capital(density),
          drawing: <DensityDrawing density={density} />,
        }))}
      />
    </>
  )
}

/** How a post’s status shows: coloured, in the text colour, as tags or in the logo’s colours. */
export function StatusControls({ design, update }: { design: PortalDesign; update: Update }) {
  const { layout } = design
  return (
    <>
      <DesignTiles
        name="design-status"
        label="Status"
        value={layout.status ?? 'colour'}
        columns={4}
        onChange={(status) => update((draft) => void (draft.layout.status = status))}
        options={DESIGN_OPTIONS.status
          .filter((status) => status !== 'brand' || (design.brand.logoColours?.length ?? 0) > 1)
          .map((status) => ({
            value: status,
            label: STATUS_LABELS[status],
            drawing: <StatusDrawing status={status} />,
          }))}
      />
    </>
  )
}

/** What a post card shows besides its title and votes. */
export function PostCardFields({ design, update }: { design: PortalDesign; update: Update }) {
  const { layout } = design
  return (
    <>
      {(
        [
          ['excerpt', 'Show a line of each post'],
          ['tags', 'Show tags'],
          ['meta', 'Show the author, date and comments'],
        ] as const
      ).map(([field, label]) => (
        <SettingRow
          key={field}
          label={label}
          htmlFor={`design-card-${field}`}
          control={
            <Switch
              id={`design-card-${field}`}
              checked={!layout.postCardHides?.includes(field)}
              onCheckedChange={(on) =>
                update((draft) => {
                  const hides = (draft.layout.postCardHides ?? []).filter((f) => f !== field)
                  if (!on) hides.push(field)
                  if (hides.length) draft.layout.postCardHides = hides
                  else delete draft.layout.postCardHides
                })
              }
            />
          }
        />
      ))}
    </>
  )
}
