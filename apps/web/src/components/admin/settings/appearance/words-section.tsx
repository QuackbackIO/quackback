import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SupportedLocale } from '@/lib/shared/i18n'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { DesignTiles } from './design-tiles'
import { LanguagePicker, languageName } from './language-picker'
import {
  BOARD_WORDS,
  oldWordUses,
  pluralOf,
  POST_WORDS,
  type BoardWord,
  type PostWord,
} from './words'

type Update = (change: (draft: PortalDesign) => void) => void

const sample = (text: string) => (
  <span className="truncate px-2 text-[11px] text-muted-foreground">{text}</span>
)

/**
 * Brand › Words: what visitors call what they post and what groups it, each
 * tile with a sentence the portal would say. After a change, the menu labels
 * and headlines that still name the old word are offered for updating.
 */
export function WordsSection({ design, update }: { design: PortalDesign; update: Update }) {
  const { post, board } = design.vocabulary
  // The words before this visit's changes, which labels and headlines may still name.
  const [before, setBefore] = useState<{ post?: PostWord; board?: BoardWord }>({})
  const postUses = before.post ? oldWordUses(design, before.post, post) : []
  const boardUses = before.board ? oldWordUses(design, before.board, board) : []
  const uses = [...postUses, ...boardUses]
  const oldWords = [postUses.length > 0 && before.post, boardUses.length > 0 && before.board]
    .filter((word): word is PostWord | BoardWord => !!word)
    .map(pluralOf)

  return (
    <section id="design-section-words" className="scroll-mt-4 space-y-4">
      <h3 className="text-sm font-semibold">Words</h3>
      <DesignTiles
        name="design-post-word"
        label="What people post"
        value={post}
        columns={2}
        onChange={(next) => {
          setBefore((was) => ({ ...was, post: was.post ?? post }))
          update((draft) => void (draft.vocabulary.post = next))
        }}
        options={(Object.keys(POST_WORDS) as PostWord[]).map((word) => ({
          value: word,
          label: POST_WORDS[word].label,
          drawing: sample(POST_WORDS[word].sample),
        }))}
      />
      <DesignTiles
        name="design-board-word"
        label="What groups them"
        value={board}
        columns={2}
        onChange={(next) => {
          setBefore((was) => ({ ...was, board: was.board ?? board }))
          update((draft) => void (draft.vocabulary.board = next))
        }}
        options={(Object.keys(BOARD_WORDS) as BoardWord[]).map((word) => ({
          value: word,
          label: BOARD_WORDS[word].label,
          drawing: sample(BOARD_WORDS[word].sample),
        }))}
      />
      {uses.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-3 text-[13px]">
          <p>Your menu and headlines still say {oldWords.join(' and ')}.</p>
          <ul className="space-y-1 text-muted-foreground">
            {uses.map((use) => (
              <li key={`${use.where}-${use.before}`}>
                {use.where}: “{use.before}” → “{use.after}”
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                update((draft) => uses.forEach((use) => use.apply(draft)))
                setBefore({})
              }}
            >
              Update them
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setBefore({})}>
              Keep them
            </Button>
          </div>
        </div>
      )}
      <OwnWording design={design} update={update} />
    </section>
  )
}

type CopyField = 'prompt' | 'submit' | 'emptyTitle'

const COPY_FIELDS: Array<{ field: CopyField; label: string; max: number }> = [
  { field: 'prompt', label: 'Composer prompt', max: 60 },
  { field: 'submit', label: 'Submit button', max: 24 },
  { field: 'emptyTitle', label: 'Empty feed title', max: 60 },
]

/** What the portal says in English for each word, shown where no wording of its own is set. */
const ENGLISH_COPY: Record<PostWord, Record<CopyField, string>> = {
  idea: {
    prompt: "What's your idea?",
    submit: 'Submit',
    emptyTitle: 'Got an idea? Be the first to share it',
  },
  post: {
    prompt: "What's on your mind?",
    submit: 'Submit',
    emptyTitle: 'Got something to say? Be the first to post',
  },
  feature_request: {
    prompt: 'What should we build?',
    submit: 'Submit',
    emptyTitle: 'Need a feature? Be the first to request it',
  },
  suggestion: {
    prompt: "What's your suggestion?",
    submit: 'Submit',
    emptyTitle: 'Got a suggestion? Be the first to share it',
  },
}

/**
 * The composer's prompt, its button and the empty feed's title in the
 * workspace's own words, per language. A language left blank says the
 * chosen word's translation.
 */
function OwnWording({ design, update }: { design: PortalDesign; update: Update }) {
  const [locale, setLocale] = useState<SupportedLocale>('en')
  const copy = design.pages.feedback.copy
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-medium">Own wording</p>
        <div className="ms-auto">
          <LanguagePicker value={locale} onChange={setLocale} label="Own wording language" />
        </div>
      </div>
      {COPY_FIELDS.map(({ field, label, max }) => (
        <div key={field} className="space-y-1.5">
          <label htmlFor={`design-copy-${field}`} className="text-[13px]">
            {label}
          </label>
          <Input
            id={`design-copy-${field}`}
            value={copy[field]?.[locale] ?? ''}
            maxLength={max}
            placeholder={
              locale === 'en'
                ? ENGLISH_COPY[design.vocabulary.post][field]
                : `The ${languageName(locale)} translation`
            }
            onChange={(event) =>
              update((draft) => {
                const byLocale = { ...draft.pages.feedback.copy[field] }
                if (event.target.value.trim()) byLocale[locale] = event.target.value
                else delete byLocale[locale]
                if (Object.keys(byLocale).length > 0) draft.pages.feedback.copy[field] = byLocale
                else delete draft.pages.feedback.copy[field]
              })
            }
          />
        </div>
      ))}
    </div>
  )
}
