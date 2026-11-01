import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { applyDesignChanges, type AppliedDesignChange } from '@/lib/shared/design/apply-changes'
import { BUNDLED_FONTS } from '@/lib/shared/design/fonts'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { ChangeValue, changeLabel, shownValue } from './change-list'
import { LookDrawing } from './preset-gallery'
import type { DesignAiTurn, DesignLook } from './use-design-ai'

type Update = (change: (draft: PortalDesign) => void) => void

/**
 * What one request changed, already in the draft: the applied state of the
 * admin's settings change card, with an Undo on each row.
 */
function DesignChangeCard({
  changes,
  readability,
  update,
}: {
  changes: AppliedDesignChange[]
  readability: string[]
  update: Update
}) {
  const [undone, setUndone] = useState<Set<string>>(new Set())
  const undo = (rows: AppliedDesignChange[]) => {
    update((draft) => {
      const restored = applyDesignChanges(
        draft,
        rows.map((row) => ({ path: row.path, value: row.before })),
        'site'
      )
      Object.assign(draft, restored.design)
    })
    setUndone((previous) => new Set([...previous, ...rows.map((row) => row.path)]))
  }
  const open = changes.filter((change) => !undone.has(change.path))
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-raise">
      <p className="text-sm font-medium">
        {open.length === 0 ? 'Changes undone' : 'Changes applied to your draft'}
      </p>
      {changes.map((change) => (
        <div key={change.path} className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{changeLabel(change.path)}</span>
            {undone.has(change.path) ? (
              <span className="text-xs text-muted-foreground">Undone</span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-my-1 focus-visible:ring-muted-foreground"
                onClick={() => undo([change])}
              >
                Undo
              </Button>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-xs">
            <ChangeValue value={shownValue(change.path, change.before)} />
            <span aria-hidden="true">→</span>
            <ChangeValue value={shownValue(change.path, change.after)} />
          </div>
        </div>
      ))}
      {readability.length > 0 && (
        <p className="text-xs text-muted-foreground">
          To keep text readable, Quackback AI also adjusted {readability.join(', ')}.
        </p>
      )}
      {open.length > 1 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="focus-visible:ring-muted-foreground"
          onClick={() => undo(open)}
        >
          Undo all
        </Button>
      )}
    </div>
  )
}

/** The colours read from an image, as small swatches. */
export function PaletteSwatches({ palette }: { palette: string[] }) {
  return (
    <span className="mt-1.5 flex gap-1" aria-label={`Colours: ${palette.join(', ')}`}>
      {palette.map((colour) => (
        <span
          key={colour}
          aria-hidden="true"
          className="size-4 rounded-full border border-border"
          style={{ backgroundColor: colour }}
        />
      ))}
    </span>
  )
}

/** A look's fonts, as the font picker names them. */
function lookFonts(look: DesignLook): string {
  const name = (font: PortalDesign['brand']['fonts']['body']) =>
    font.kind === 'bundled' ? BUNDLED_FONTS[font.id].label : font.family
  const { heading, body } = look.design.brand.fonts
  const [h, b] = [name(heading), name(body)]
  return h === b ? h : `${h} and ${b}`
}

/**
 * Ask AI: the conversation. Before the first request it offers ways to start;
 * every start ends in the draft, and nothing is live until a person publishes.
 */
export function AskAiPanel({
  available,
  turns,
  busy,
  update,
  onStart,
  onLook,
  onPresets,
  onWiden,
  onImage,
}: {
  available: boolean
  turns: DesignAiTurn[]
  busy: boolean
  update: Update
  onStart: (kind: 'website' | 'words', value: string) => void
  onLook: (look: DesignLook) => void
  onPresets: () => void
  /** Asks a request again about the whole site, when it reached outside the section picked. */
  onWiden: (text: string) => void
  /**
   * Starts from a logo or a screenshot; `useAsLogo` also makes it the workspace
   * logo, and a website typed above is read with it.
   */
  onImage: (file: File, useAsLogo: boolean, site: string | null) => void
}) {
  const [site, setSite] = useState('')
  const [words, setWords] = useState('')
  const [useAsLogo, setUseAsLogo] = useState(false)

  if (!available) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Quackback AI is not set up for this workspace. Brand and Sections work in full.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 && (
        <div className="space-y-4">
          <p className="text-[13px] text-muted-foreground">
            Start from your website, a few words or a preset. Changes go into your draft.
          </p>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (site.trim() && !busy) onStart('website', site.trim())
            }}
          >
            <label htmlFor="ai-site" className="text-[13px] font-medium">
              Match my website
            </label>
            <div className="flex gap-2">
              <Input
                id="ai-site"
                placeholder="example.com"
                value={site}
                onChange={(event) => setSite(event.target.value)}
              />
              <Button type="submit" variant="outline" disabled={!site.trim() || busy}>
                Go
              </Button>
            </div>
            {site.trim() && (
              <p className="text-xs text-muted-foreground">
                For a closer match, add a screenshot of it below.
              </p>
            )}
          </form>
          <div className="space-y-2">
            <label htmlFor="ai-words" className="text-[13px] font-medium">
              Describe your brand
            </label>
            <Textarea
              id="ai-words"
              rows={2}
              placeholder="Calm and friendly, deep green, lots of room"
              value={words}
              onChange={(event) => setWords(event.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!words.trim() || busy}
              onClick={() => onStart('words', words.trim())}
            >
              Suggest three looks
            </Button>
          </div>
          <div className="space-y-2">
            <label htmlFor="ai-image" className="text-[13px] font-medium">
              Start from your logo or a screenshot
            </label>
            <Input
              id="ai-image"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onImage(file, useAsLogo, site.trim() || null)
              }}
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="ai-image-logo"
                checked={useAsLogo}
                onCheckedChange={(checked) => setUseAsLogo(checked === true)}
              />
              <label htmlFor="ai-image-logo" className="text-xs text-muted-foreground">
                Also make it our logo
              </label>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="-ms-2" onClick={onPresets}>
            Start from a preset
          </Button>
        </div>
      )}

      <ol className="space-y-3" aria-live="polite">
        {turns.map((turn, index) => (
          <li key={index} className={cn('text-[13.5px]', turn.role === 'user' && 'ms-8')}>
            {turn.role === 'user' ? (
              <div className="rounded-2xl bg-muted px-3 py-2">
                <p>{turn.text}</p>
                {turn.palette && <PaletteSwatches palette={turn.palette} />}
              </div>
            ) : (
              <div className="space-y-2">
                <p>{turn.text}</p>
                {turn.widen && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onWiden(turn.widen!)}
                  >
                    Ask about the whole site
                  </Button>
                )}
                {turn.changes && turn.changes.length > 0 && (
                  <DesignChangeCard
                    changes={turn.changes}
                    readability={turn.readability ?? []}
                    update={update}
                  />
                )}
                {turn.looks && (
                  <div className="grid grid-cols-1 gap-2">
                    {turn.looks.map((look) => (
                      <button
                        key={look.name}
                        type="button"
                        className="flex items-center gap-3 rounded-lg border border-border p-2 text-start hover:bg-muted/40"
                        onClick={() => {
                          onLook(look)
                          update((draft) => void Object.assign(draft, look.design))
                        }}
                      >
                        <span className="w-28 shrink-0">
                          <LookDrawing look={look.design} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium">{look.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {look.description}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {lookFonts(look)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
        {busy && (
          <li className="text-[13px] text-muted-foreground" aria-busy="true">
            Working on it…
          </li>
        )}
      </ol>
    </div>
  )
}
