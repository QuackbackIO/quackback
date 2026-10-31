import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { imagePalette } from '@/lib/client/image-palette'
import type { DesignAiScope } from '@/lib/shared/design/apply-changes'
import { PaletteSwatches } from './ask-ai-panel'

const SCOPE_LABEL: Record<DesignAiScope, string> = {
  site: 'Whole site',
  brand: 'Brand',
  header: 'Header',
  band: 'Top band',
  welcome: 'Welcome message',
  feed: 'Feed',
  filters: 'Filters',
  home: 'Home',
}

/**
 * The Appearance composer, under every tab, in the shape of the admin chat
 * composer. Its chip says which part of the portal a request may change. An
 * attached logo or screenshot sends only its colours, read in the browser.
 */
export function DesignComposer({
  scope,
  busy,
  onClearScope,
  onAsk,
}: {
  scope: DesignAiScope
  busy: boolean
  onClearScope: () => void
  onAsk: (text: string, palette?: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [image, setImage] = useState<{ name: string; palette: string[] } | null>(null)
  const text = query.trim()
  const send = () => {
    if (!text || busy) return
    setQuery('')
    setImage(null)
    onAsk(text, image?.palette)
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-float transition-[box-shadow,border-color] duration-300 ease-out focus-within:border-muted-foreground focus-within:shadow-float-focus motion-reduce:transition-none">
      <Textarea
        aria-label="Ask Quackback AI"
        placeholder="Ask for a change, such as warmer colours"
        rows={2}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="max-h-40 min-h-16 resize-none rounded-none border-0 px-2 py-1 shadow-none focus:border-transparent"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            send()
          }
        }}
      />
      {image && (
        <div className="mb-2 flex items-center gap-2 ps-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{image.name}</span>
          <PaletteSwatches palette={image.palette} />
          <button
            type="button"
            aria-label="Remove the image"
            className="rounded-full px-1 hover:bg-muted hover:text-foreground"
            onClick={() => setImage(null)}
          >
            ×
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 ps-2">
        <label
          className="flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Attach a logo or a screenshot"
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            aria-label="Attach an image"
            className="sr-only"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              const palette = await imagePalette(file)
              if (palette.length) setImage({ name: file.name, palette })
            }}
          />
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
            <path
              d="M10.5 5.5 6 10a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4l-5 5a4.2 4.2 0 0 0 6 6l4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </label>
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {SCOPE_LABEL[scope]}
          {scope !== 'site' && (
            <button
              type="button"
              aria-label="Clear the section"
              className="-me-1 rounded-full px-1 hover:bg-muted hover:text-foreground"
              onClick={onClearScope}
            >
              ×
            </button>
          )}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label="Send"
          className="ms-auto shrink-0 rounded-full focus-visible:ring-muted-foreground"
          disabled={!text || busy}
          onClick={send}
        >
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
            <path
              d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
      </div>
    </div>
  )
}
