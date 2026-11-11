import { Suspense, useCallback, type ComponentProps, type ComponentType } from 'react'
import type { EditorDocument, RichTextEditor } from '@/components/ui/rich-text-editor'
import { LazyRichTextEditor, RichTextEditorEmptyState } from '@/components/ui/lazy-rich-text-editor'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import type { TiptapContent } from '@/lib/shared/db-types'

const PLACEHOLDER = "Tell visitors what kind of feedback you'd love to hear…"
const MIN_HEIGHT = '160px'

/**
 * Isolated so the rich-text editor's heavy deps don't re-render the page. The
 * editor loads as its own chunk the first time this draws, so a page that
 * only offers it behind a click, such as the builder, never loads it on open.
 * A page that always shows it passes the editor it imports itself as `editor`.
 */
export function WelcomeBodyEditor({
  value,
  onChange,
  editor: Editor = LazyRichTextEditor,
}: {
  value: TiptapContent
  onChange: (v: TiptapContent) => void
  /** The editor, where the page loads it with itself. */
  editor?: ComponentType<ComponentProps<typeof RichTextEditor>>
}) {
  const { upload: uploadImage } = useImageUpload({ prefix: 'portal-welcome' })
  // The editor reports its document once it mounts. The same document again
  // is not an edit, and adopting that copy would re-render the whole page.
  // The live preview and the dirty check read the JSON, so each edit takes it.
  const handleChange = useCallback(
    (document: EditorDocument) => {
      const json = document.json()
      if (JSON.stringify(json) === JSON.stringify(value)) return
      onChange(json as TiptapContent)
    },
    [value, onChange]
  )
  return (
    <Suspense
      fallback={<RichTextEditorEmptyState placeholder={PLACEHOLDER} minHeight={MIN_HEIGHT} />}
    >
      <Editor
        value={value}
        onDocumentChange={handleChange}
        placeholder={PLACEHOLDER}
        minHeight={MIN_HEIGHT}
        className="[&_button]:size-6 [&_button_svg]:size-3.5"
        features={{
          headings: true,
          images: true,
          codeBlocks: true,
          taskLists: true,
          blockquotes: true,
          tables: true,
          dividers: true,
          bubbleMenu: true,
          slashMenu: true,
          embeds: true,
          quackbackEmbeds: true,
        }}
        onImageUpload={uploadImage}
      />
    </Suspense>
  )
}
