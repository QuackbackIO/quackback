import type { Update } from '@/components/admin/settings/appearance/design-update'
import type { DesignerPage } from '@/lib/shared/design/outline'
import { PAGE_CHOICE_DEFAULTS, type PageChoices } from '@/lib/shared/design/page-choices'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { PropertyRow, PropertyTiles } from './properties/properties-panel'
import { FIND } from './find-rows'
import { WORDS } from './properties/words'

type ChoicePage = keyof PageChoices

/**
 * Sets one of a page's choices. Today's look is no choice at all, so picking
 * it again leaves the design as it was before the page was touched.
 */
function choose<P extends ChoicePage, K extends keyof PageChoices[P]>(
  update: Update,
  page: P,
  key: K,
  value: PageChoices[P][K]
) {
  update((draft) => {
    const made = { ...draft.pages[page] } as Record<string, unknown>
    if (value === PAGE_CHOICE_DEFAULTS[page][key]) delete made[key as string]
    else made[key as string] = value
    if (Object.keys(made).length) (draft.pages as Record<string, unknown>)[page] = made
    else delete draft.pages[page]
  })
}

function current<P extends ChoicePage>(design: PortalDesign, page: P): PageChoices[P] {
  return { ...PAGE_CHOICE_DEFAULTS[page], ...design.pages[page] } as PageChoices[P]
}

/** Whether a page's choice is made, rather than left at today's look. */
const made = (design: PortalDesign, page: ChoicePage, key: string) =>
  Object.hasOwn((design.pages[page] ?? {}) as object, key)

/**
 * What sits with a page's title, as rows of the properties frame: the
 * changelog's Subscribe, the help center's search. A choice made shows a dot
 * and a Reset back to today's look.
 */
export function PageTitleRows({
  page,
  design,
  update,
}: {
  page: DesignerPage
  design: PortalDesign
  update: Update
}) {
  if (page === 'changelog') {
    const fallback = PAGE_CHOICE_DEFAULTS.changelog.subscribe
    return (
      <PropertyRow
        label={FIND.subscribe.label}
        find={FIND.subscribe.id}
        set={made(design, 'changelog', 'subscribe')}
        resetLabel={`${WORDS.reset} subscribe to beside`}
        onReset={() => choose(update, 'changelog', 'subscribe', fallback)}
      >
        <PropertyTiles
          label="Subscribe"
          value={
            made(design, 'changelog', 'subscribe')
              ? current(design, 'changelog').subscribe
              : undefined
          }
          inherited={fallback}
          options={[
            ['beside', 'Beside'],
            ['under', 'Under'],
          ]}
          onChange={(value) => choose(update, 'changelog', 'subscribe', value)}
        />
      </PropertyRow>
    )
  }
  if (page === 'help') {
    const fallback = PAGE_CHOICE_DEFAULTS.help.search
    return (
      <PropertyRow
        label={FIND.search.label}
        find={FIND.search.id}
        set={made(design, 'help', 'search')}
        resetLabel={`${WORDS.reset} search to standard`}
        onReset={() => choose(update, 'help', 'search', fallback)}
      >
        <PropertyTiles
          label="Search size"
          value={made(design, 'help', 'search') ? current(design, 'help').search : undefined}
          inherited={fallback}
          options={[
            ['standard', 'Standard'],
            ['large', 'Large'],
          ]}
          onChange={(value) => choose(update, 'help', 'search', value)}
        />
      </PropertyRow>
    )
  }
  return null
}
