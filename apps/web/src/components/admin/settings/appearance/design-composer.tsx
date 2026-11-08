import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/16/solid'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { readBrandShot, type BrandShot } from '@/lib/client/brand-shots'
import { imageForModel, imagePalette } from '@/lib/client/image-palette'
import { MATCH_BRAND } from '@/lib/shared/design/match-brand'
import type { DesignAiScope } from '@/lib/shared/design/apply-changes'
import type { AiReach, ReachChoice } from '@/lib/shared/design/ai-reach'
import type { BrandContext, ChatImage } from './use-design-ai'
import { useShotChecks } from './use-shot-checks'

/** Each scope as the composer's chip names it. */
export const SCOPE_LABEL: Record<DesignAiScope, string> = {
  site: 'Whole site',
  brand: 'Site styles',
  header: 'Header',
  band: 'Hero',
  welcome: 'Welcome message',
  feed: 'Feed',
  filters: 'Filters',
  home: 'Home',
  headline: 'Headline',
  subtitle: 'Subtitle',
  heading: 'Section headings',
  menu: 'Menu',
  button: 'Buttons',
  card: 'Cards',
  vote: 'Vote boxes',
  field: 'Fields',
  logo: 'Logo',
  status: 'Status and tags',
  link: 'Links',
  secondary: 'Secondary buttons',
  body: 'Body text',
  roadmap: 'Roadmap page',
  changelog: 'Changelog page',
  help: 'Help Center page',
  post: 'Post page',
}

/** An example request for each part, so the box says what a request there can change. */
const EXAMPLE: Partial<Record<DesignAiScope, string>> = {
  brand: 'warmer colours',
  header: 'a centred logo',
  band: 'a bolder hero',
  headline: 'a lighter, larger headline',
  heading: 'smaller section headings',
  menu: 'menu labels in capitals',
  button: 'rounder buttons',
  card: 'flatter cards',
  field: 'square fields',
  logo: 'a smaller logo',
}

/** Most images one message carries. */
export const MAX_IMAGES = 4

/** The kinds of image the composer takes. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

/** The largest picture sent, as a data URL; the model reads a downscaled JPEG, so this is rarely met. */
const MAX_DATA_LENGTH = 700_000

interface Attached extends ChatImage {
  id: number
  name: string
  /** The picture the thumbnail shows. */
  thumbnail: string
  /** A screenshot as the browser read it, for matching a brand from it. */
  shot: BrandShot | null
}

/** The files a paste or drop carries. */
function filesOf(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = Array.from(data.files ?? [])
  if (files.length) return files
  return Array.from(data.items ?? []).flatMap((item) => {
    const file = item.kind === 'file' ? item.getAsFile() : null
    return file ? [file] : []
  })
}

/**
 * The Appearance composer, under every tab, in the shape of the admin chat
 * composer. Its chip says which part of the portal a request may change. An
 * attached picture, pasted, dropped or picked, shows as a thumbnail (up to
 * four) and goes with the message.
 */
export function DesignComposer({
  id,
  scope,
  label,
  context = null,
  busy,
  limited,
  onClearScope,
  onAsk,
  onStop,
  prefill = null,
  below,
}: {
  /** The request box's id, so a shortcut can focus it. */
  id?: string
  scope: DesignAiScope
  /** What is picked, when it is narrower than the scope, such as one block. */
  label?: string
  /** The block picked in the builder, which rides along with a request; its X lets it go. */
  context?: ChatContext | null
  busy: boolean
  /** Why Quackback AI cannot run just now, such as its allowance used, said in place of the box. */
  limited?: string | null
  onClearScope: () => void
  /** A message; with screenshots, how they were read, for a brand started from them. */
  onAsk: (text: string, images?: ChatImage[], brand?: BrandContext) => void
  /** Stops the request running; while one runs, Stop takes Send's place and Escape stops it. */
  onStop?: () => void
  /**
   * Words to put in the box, such as an example chosen; a new `seq` puts them
   * in again. A hint instead says in the empty box what to put there.
   */
  prefill?: { text: string; seq: number; hint?: string } | null
  /** A quiet line under the box for what is typed, such as captures running low. */
  below?: (text: string) => ReactNode
}) {
  const [query, setQuery] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!prefill) return
    setQuery(prefill.text)
    box.current?.focus()
  }, [prefill])
  // A hint lasts until the request it asked for is sent.
  const [sentFrom, setSentFrom] = useState<number | null>(null)
  const hint = prefill?.hint && prefill.seq !== sentFrom && !query ? prefill.hint : null
  const [images, setImages] = useState<Attached[]>([])
  const [note, setNote] = useState('')
  const [over, setOver] = useState(false)
  // Images being read, so a quick run of pastes still keeps to the limit.
  const reading = useRef(0)
  const nextId = useRef(0)
  const text = query.trim()
  const checks = useShotChecks(images)
  const warned = images.findIndex((_, index) => checks.warnings[index])
  // Words, or screenshots alone, which match the brand from them; never while the
  // screenshots are checked or a warning waits.
  const sendable = (!!text || images.length > 0) && !busy && !checks.reading && warned < 0
  const send = () => {
    if (!sendable) return
    const brand = checks.brand()
    setSentFrom(prefill?.seq ?? null)
    setQuery('')
    setImages([])
    setNote('')
    const sent = images.length
      ? images.map(({ palette, image }) => ({ palette, ...(image && { image }) }))
      : undefined
    if (brand) onAsk(text, sent, brand)
    else onAsk(text, sent)
  }
  const add = async (files: File[]) => {
    const kept = files.filter((file) => IMAGE_TYPES.has(file.type))
    let message = kept.length < files.length ? 'Only PNG, JPEG, WebP or SVG images.' : ''
    const room = Math.max(0, MAX_IMAGES - images.length - reading.current)
    const taken = kept.slice(0, room)
    if (kept.length > taken.length) message = `Up to ${MAX_IMAGES} images. The rest were left out.`
    setNote(message)
    reading.current += taken.length
    const read = await Promise.all(
      taken.map(async (file): Promise<Attached | null> => {
        // Its colours, the picture itself for a model that reads images, and the
        // screenshot as the browser reads it, for matching a brand from it.
        const [palette, data, shot] = await Promise.all([
          imagePalette(file),
          imageForModel(file),
          readBrandShot(file),
        ])
        if ((!palette.length && !data) || (data && data.length > MAX_DATA_LENGTH)) {
          setNote(`${file.name} could not be read.`)
          return null
        }
        const id = nextId.current++
        return {
          id,
          name: file.name,
          palette,
          ...(data && { image: data }),
          thumbnail: data ?? URL.createObjectURL(file),
          shot,
        }
      })
    )
    reading.current -= taken.length
    const added = read.filter((item): item is Attached => item !== null)
    if (added.length) setImages((current) => [...current, ...added].slice(0, MAX_IMAGES))
  }
  // While a request runs, the send button is Stop: the same button, so focus stays on it.
  const stoppable = busy && !!onStop
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !stoppable || event.defaultPrevented) return
    // Escape here stops the request; it does not also step back in the builder.
    event.preventDefault()
    onStop()
  }
  const onPaste = (event: ClipboardEvent) => {
    const files = filesOf(event.clipboardData)
    if (!files.length) return
    event.preventDefault()
    void add(files)
  }
  const carriesFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    setOver(false)
    void add(filesOf(event.dataTransfer))
  }
  if (limited)
    return (
      <p className="rounded-2xl border border-border bg-card p-3 text-[13px] text-muted-foreground">
        {limited}
      </p>
    )
  return (
    <div
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'rounded-2xl border bg-card p-3 shadow-float transition-[box-shadow,border-color] duration-300 ease-out focus-within:border-muted-foreground focus-within:shadow-float-focus motion-reduce:transition-none',
        over ? 'border-muted-foreground' : 'border-border'
      )}
    >
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-2 pb-1 pt-2" aria-label="Attached images">
          {images.map((item, index) => (
            <li key={item.id} className="relative">
              <img
                src={item.thumbnail}
                alt={item.name}
                className="size-14 rounded-lg border border-border object-cover"
              />
              {checks.warnings[index] && (
                <span
                  role="img"
                  aria-label={`${item.name}: ${checks.warnings[index] === 'dimmed' ? 'dimmed by a pop-up' : 'under a cookie banner'}`}
                  className="absolute -bottom-1.5 -start-1.5 inline-flex size-5 items-center justify-center rounded-full border border-border bg-background text-warning"
                >
                  <ExclamationTriangleIcon className="size-3" aria-hidden="true" />
                </span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    className="absolute -end-2 -top-2 inline-flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                    onClick={() =>
                      setImages((current) => current.filter((it) => it.id !== item.id))
                    }
                  >
                    <XMarkIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Remove</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      {warned >= 0 && (
        <div className="flex flex-wrap items-center gap-x-2 px-2 pb-1 text-xs">
          <p className="text-muted-foreground">
            {checks.warnings[warned] === 'dimmed' ? MATCH_BRAND.dimmed : MATCH_BRAND.banner}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => checks.keep(images[warned]!.id)}
          >
            {MATCH_BRAND.keep}
          </Button>
        </div>
      )}
      {checks.reading && (
        <p className="px-2 pb-1 text-xs text-muted-foreground">{MATCH_BRAND.checking}</p>
      )}
      <Textarea
        ref={box}
        id={id}
        aria-label="Ask Quackback AI"
        placeholder={
          hint
            ? hint
            : context
              ? `Ask about ${context.name}`
              : scope === 'site'
                ? 'Ask for a change, or paste your website to match it'
                : `Ask for a change, such as ${EXAMPLE[scope] ?? 'warmer colours'}`
        }
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
      <p role="status" className={note ? 'mb-2 ps-2 text-xs text-muted-foreground' : 'sr-only'}>
        {note}
      </p>
      {below?.(text)}
      <div className="flex items-center gap-2 ps-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                aria-label="Attach an image"
                className="sr-only"
                disabled={busy}
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  if (files.length) void add(files)
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
          </TooltipTrigger>
          <TooltipContent>Attach images, or paste them</TooltipContent>
        </Tooltip>
        {context ? (
          <ContextChip context={context} onClear={onClearScope} />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground"
              >
                {label ?? SCOPE_LABEL[scope]}
                {scope !== 'site' && (
                  <button
                    type="button"
                    aria-label="Widen to the whole site"
                    className="-me-1 inline-flex size-6 items-center justify-center rounded-full hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                    onClick={onClearScope}
                  >
                    <XMarkIcon className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {scope === 'site'
                ? 'A request can change anything in the design'
                : `A request changes ${(label ?? SCOPE_LABEL[scope]).toLowerCase()} only`}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label={stoppable ? 'Stop' : 'Send'}
              aria-keyshortcuts={stoppable ? 'Escape' : undefined}
              className="ms-auto shrink-0 rounded-full focus-visible:ring-muted-foreground"
              disabled={!stoppable && !sendable}
              onClick={stoppable ? onStop : send}
            >
              {stoppable ? (
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                  <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" />
                </svg>
              ) : (
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
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{stoppable ? 'Stop (Esc)' : 'Send'}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * What rides along with a request: the picked block, section or element by
 * name, the page it is on, and for an element the section it is in. Its
 * reach says how far a request may change it, the panel's own scope first,
 * and goes with the request as its `within`.
 */
export interface ChatContext {
  name: string
  page: string
  /** The section an element picked inside it is in: "Hero". */
  section?: string
  /** How far a request may reach: the choices, the one chosen, and a way to choose another. */
  reach?: {
    choices: readonly ReachChoice[]
    value: AiReach
    onChange: (reach: AiReach) => void
  }
}

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** Where the picked part is and how far a request reaches: "Hero · every main button", "Every page (4)". */
function reachLine(context: ChatContext): string {
  const chosen = context.reach?.choices.find((choice) => choice.reach === context.reach!.value)
  if (!chosen)
    return context.section ? `${context.section} on ${context.page}` : `On ${context.page}`
  return context.section ? `${context.section} · ${chosen.words}` : capital(chosen.words)
}

/**
 * The picked block or element riding along with a request: its name, where
 * it is and how far a request reaches (a click takes the next reach, where
 * there is more than one), and an X that takes it out of the chat and lets
 * go of it on the page.
 */
export function ContextChip({ context, onClear }: { context: ChatContext; onClear: () => void }) {
  const line = reachLine(context)
  const choices = context.reach?.choices ?? []
  const next = () => {
    const at = choices.findIndex((choice) => choice.reach === context.reach!.value)
    context.reach!.onChange(choices[(at + 1) % choices.length]!.reach)
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-muted py-0.5 ps-2 pe-0.5 text-xs">
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium text-foreground">{context.name}</span>
        {choices.length > 1 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`How far a request reaches: ${line}`}
                className="block max-w-full truncate rounded text-start text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                onClick={next}
              >
                {line}
              </button>
            </TooltipTrigger>
            <TooltipContent>How far a request reaches</TooltipContent>
          </Tooltip>
        ) : (
          <span className="block truncate text-muted-foreground">{line}</span>
        )}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Remove ${context.name} from the chat and deselect it`}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
            onClick={onClear}
          >
            <XMarkIcon className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Remove it from the chat and deselect it on the page</TooltipContent>
      </Tooltip>
    </span>
  )
}
