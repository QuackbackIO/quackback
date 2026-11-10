import { WelcomeBodyEditor } from '@/components/admin/settings/branding/welcome-body-editor'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { WordsDoc } from '@/lib/shared/design/rich-words'
import { checkedWords, isValidWords } from '@/lib/shared/design/words-schema'
import type { WordsRole } from '@/lib/shared/design/colour-roles'
import { WordsField } from './words-field'

/**
 * A Welcome message's words: rich words (paragraphs, H2 and H3 headings,
 * bold, italic, links, lists, alignment and the brand's colours), edited as
 * on the canvas. A message written earlier with more, such as images, other
 * headings or tables, keeps the full editor so nothing is lost.
 */
export function WelcomeWords({
  label = 'Words',
  value,
  onChange,
  roles,
}: {
  label?: string
  value: TiptapContent
  onChange: (body: TiptapContent) => void
  /** The brand's colour roles words may be drawn in. */
  roles?: readonly WordsRole[]
}) {
  const doc = value as unknown as WordsDoc
  if (!isValidWords(doc, 'rich'))
    return (
      <div className="space-y-1.5">
        <WelcomeBodyEditor value={value} onChange={onChange} />
        <p className="text-[12px] text-muted-foreground">
          This message has images, tables or other headings, so it is edited here rather than on the
          page.
        </p>
      </div>
    )
  return (
    <WordsField
      label={label}
      kind="rich"
      value={doc}
      roles={roles}
      placeholder="Tell visitors what kind of feedback you’d love to hear"
      onChange={(next) => onChange(checkedWords(next, 'rich') as unknown as TiptapContent)}
    />
  )
}
