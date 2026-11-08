/**
 * The feed's own words, each a row with what it says in the language the
 * canvas shows (View > Language) and Edit, which opens it where the page
 * draws it: the composer's prompt and button on the Composer part, and the
 * empty feed's title on the Feed part, which can be previewed empty to edit
 * it in place. Words left unset show the portal's own, in grey.
 */
import { useEffect, useId, useSyncExternalStore } from 'react'
import { Switch } from '@/components/ui/switch'
import {
  designerPreview,
  setDesignerPreview,
  subscribeDesignerPreview,
} from '@/components/public/preview-draft-context'
import {
  setFeedWords,
  setRequestWords,
  type FeedWordsPart,
} from '@/lib/shared/design/headline-words'
import { inLanguage } from '@/lib/shared/design/labels'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { WordsRow } from './block-sections'
import { PropertyRow, PropertySection } from './properties/properties-panel'
import { FIND, type FindRow } from './find-rows'
import { WORDS } from './properties/words'
import { editOnCanvas } from './words/edit-on-canvas'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** What the portal says without words of its own, in English as the block rows show it. */
const USUAL: Record<FeedWordsPart, string> = {
  prompt: "What's on your mind?",
  submit: 'Post',
  emptyTitle: 'Got something to say? Be the first to post',
}

/** Each of the feed's words rows, by its label and stable name (find-rows.ts). */
const ROWS: Record<FeedWordsPart, FindRow> = {
  prompt: FIND.prompt,
  submit: FIND.submit,
  emptyTitle: FIND.emptyTitle,
}

/** One of the feed's words: its own in the language shown, else the portal's, and Edit. */
function FeedWordsRow({
  part,
  design,
  update,
  locale,
  onEdit,
}: {
  part: FeedWordsPart
  design: PortalDesign
  update: NamedUpdate
  locale: string
  onEdit?: () => void
}) {
  const words = design.pages.feedback.copy[part] ?? {}
  const own = words[locale] || null
  const others = Object.entries(words)
    .filter(([other, text]) => other !== locale && text)
    .map(([, text]) => text)
  const label = inLanguage(ROWS[part].label, locale)
  return (
    <WordsRow
      label={label}
      find={ROWS[part].id}
      text={own}
      usual={USUAL[part]}
      set={!!own}
      others={others}
      resetLabel={`${WORDS.reset} to “${USUAL[part]}”`}
      onReset={() => update((draft) => setFeedWords(draft, part, locale, ''), `${label}: words`)}
      onEdit={() => {
        onEdit?.()
        editOnCanvas(`feedback.${part}`)
      }}
    />
  )
}

/** The composer's words: its prompt and its button. */
export function ComposerWords({
  design,
  update,
  locale,
}: {
  design: PortalDesign
  update: NamedUpdate
  locale: string
}) {
  return (
    <PropertySection title={WORDS.words}>
      <FeedWordsRow part="prompt" design={design} update={update} locale={locale} />
      <FeedWordsRow part="submit" design={design} update={update} locale={locale} />
    </PropertySection>
  )
}

/** Whether the canvas shows the feed empty, as the builder asks; off again once the panel closes. */
function usePreviewEmpty(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeDesignerPreview, () => designerPreview().empty)
  useEffect(() => () => setDesignerPreview({ empty: false }), [])
  return [on, (next) => setDesignerPreview({ empty: next })]
}

/** The empty feed: Preview empty, and its title, which shows the feed empty to edit it. */
export function EmptyFeedWords({
  design,
  update,
  locale,
}: {
  design: PortalDesign
  update: NamedUpdate
  locale: string
}) {
  const id = useId()
  const [empty, setEmpty] = usePreviewEmpty()
  return (
    <PropertySection title="When empty">
      <PropertyRow
        label={FIND.previewEmpty.label}
        find={FIND.previewEmpty.id}
        htmlFor={`${id}-empty`}
      >
        <Switch
          id={`${id}-empty`}
          aria-label={FIND.previewEmpty.label}
          checked={empty}
          onCheckedChange={setEmpty}
        />
      </PropertyRow>
      <FeedWordsRow
        part="emptyTitle"
        design={design}
        update={update}
        locale={locale}
        onEdit={() => setEmpty(true)}
      />
    </PropertySection>
  )
}

/** What the support page's New request button says without words of its own. */
const REQUEST_USUAL = 'New conversation'

/** The support page's New request button words: its own in the language shown, and Edit. */
export function RequestWords({
  design,
  update,
  locale,
}: {
  design: PortalDesign
  update: NamedUpdate
  locale: string
}) {
  const words = design.pages.support?.request ?? {}
  const own = words[locale] || null
  const others = Object.entries(words)
    .filter(([other, text]) => other !== locale && text)
    .map(([, text]) => text)
  const label = inLanguage(FIND.requestWords.label, locale)
  return (
    <PropertySection title={WORDS.words}>
      <WordsRow
        label={label}
        find={FIND.requestWords.id}
        text={own}
        usual={REQUEST_USUAL}
        set={!!own}
        others={others}
        resetLabel={`${WORDS.reset} to “${REQUEST_USUAL}”`}
        onReset={() => update((draft) => setRequestWords(draft, locale, ''), `${label}: words`)}
        onEdit={() => editOnCanvas('support.request')}
      />
    </PropertySection>
  )
}
