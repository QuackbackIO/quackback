import { useCallback } from 'react'
import { RichTextEditor, type EditorDocument } from '@/components/ui/rich-text-editor'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import type { TiptapContent } from '@/lib/shared/db-types'

/** Isolated so the rich-text editor's heavy deps don't re-render the page. */
export function WelcomeBodyEditor({
  value,
  onChange,
}: {
  value: TiptapContent
  onChange: (v: TiptapContent) => void
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
    <RichTextEditor
      value={value}
      onDocumentChange={handleChange}
      placeholder="Tell visitors what kind of feedback you'd love to hear…"
      minHeight="160px"
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
  )
}
