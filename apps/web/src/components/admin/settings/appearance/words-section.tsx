import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { DesignTiles } from './design-tiles'
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
    </section>
  )
}
