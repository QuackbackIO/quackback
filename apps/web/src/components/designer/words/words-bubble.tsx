import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  Bars3BottomLeftIcon,
  Bars3BottomRightIcon,
  Bars3Icon,
  BoldIcon,
  EllipsisHorizontalIcon,
  H2Icon,
  H3Icon,
  ItalicIcon,
  LinkIcon,
  LinkSlashIcon,
  ListBulletIcon,
  NumberedListIcon,
} from '@heroicons/react/16/solid'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ACCENT_LOOKS, ACCENT_MAX, type WordsAlign } from '@/lib/shared/design/rich-words'
import type { WordsRole } from '@/lib/shared/design/colour-roles'
import {
  accentFits,
  hrefOf,
  type WordsCommand,
  type WordsState,
} from '@/lib/shared/words-editor/extensions'
import { cn } from '@/lib/shared/utils'
import { WORDS } from '../properties/words'
import { Swatch } from '../swatch'

const MOD =
  typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl+'

/** Whether More is open: once opened, it stays open for the session. */
let moreOpen = false

/** Closes More again, as a new session starts it. */
export function resetWordsMore(): void {
  moreOpen = false
}

/**
 * The format bar over selected words: only the marks the words allow. A
 * headline sets one phrase apart as Accent, Highlight or Lighter; rich words
 * take bold, italic, a link and lists; plain words get no bar. More holds the
 * rest: headings, alignment and the brand's colours for rich words, and the
 * colour a headline's phrase is drawn in. Buttons keep the editor's focus
 * when clicked; from the keyboard, Alt+F10 in the editor brings focus here,
 * arrows move along the bar and Escape goes back.
 */
export function WordsBubble({
  state,
  onCommand,
  onReturn,
  roles = [],
  focusOnMount = false,
  linkRequested = 0,
  className,
}: {
  state: WordsState
  onCommand: (command: WordsCommand) => void
  /** The brand's colour roles words may be drawn in, the brand colour first. */
  roles?: readonly WordsRole[]
  /** Focus goes back to the words, after Escape or a link is set. */
  onReturn: () => void
  /** Takes focus as it appears, as Alt+F10 asks. */
  focusOnMount?: boolean
  /** Changes when Mod-K asks for a link, which opens the address field. */
  linkRequested?: number
  className?: string
}) {
  const bar = useRef<HTMLDivElement>(null)
  const [linking, setLinking] = useState(false)
  const [more, setMore] = useState(moreOpen)
  const toggleMore = () => {
    moreOpen = !more
    setMore(moreOpen)
  }
  useEffect(() => {
    if (focusOnMount)
      bar.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
  }, [focusOnMount])
  useEffect(() => {
    if (linkRequested && state.kind === 'rich') setLinking(true)
  }, [linkRequested, state.kind])

  if (state.kind === 'plain') return null
  const back = () => {
    setLinking(false)
    onReturn()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      back()
      return
    }
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    if ((event.target as HTMLElement).tagName === 'INPUT') return
    const buttons = [
      ...(bar.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []),
    ]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      buttons[(at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]
    event.preventDefault()
    next?.focus()
  }

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={state.kind === 'headline' ? 'Set words apart' : 'Format words'}
      aria-orientation="horizontal"
      data-words-bubble=""
      onKeyDownCapture={onKeyDown}
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md',
        className
      )}
    >
      {linking ? (
        <LinkField
          current={state.link}
          onDone={(href) => {
            if (href) onCommand({ type: 'link', href })
            back()
          }}
        />
      ) : state.kind === 'headline' ? (
        <HeadlineMarks
          state={state}
          onCommand={onCommand}
          roles={roles}
          more={more}
          onMore={toggleMore}
        />
      ) : (
        <RichMarks
          state={state}
          onCommand={onCommand}
          onLink={() => setLinking(true)}
          roles={roles}
          more={more}
          onMore={toggleMore}
        />
      )}
    </div>
  )
}

const Row = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-0.5">{children}</div>
)

const Divider = () => <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />

function MoreButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <BarButton
      label="More"
      tip={open ? 'Fewer options' : 'Headings, alignment and colour'}
      expanded={open}
      onPress={onPress}
    >
      <EllipsisHorizontalIcon className="size-4" />
    </BarButton>
  )
}

/** Accent, Highlight and Lighter: one phrase per headline, so a new one moves it. */
function HeadlineMarks({
  state,
  onCommand,
  roles,
  more,
  onMore,
}: {
  state: WordsState
  onCommand: (command: WordsCommand) => void
  roles: readonly WordsRole[]
  more: boolean
  onMore: () => void
}) {
  const fits = accentFits(state)
  // The phrase's colour, where there is a phrase drawn in colour and more than one colour to pick.
  const phrase = state.accent ?? (state.accentElsewhere ? 'elsewhere' : null)
  const colours = roles.length > 1 && phrase !== null && phrase !== 'muted'
  const marks = ACCENT_LOOKS.map(({ style, name, looks }) => (
    <BarButton
      key={style}
      label={name}
      tip={
        !fits && !state.accent
          ? `A phrase set apart is up to ${ACCENT_MAX} characters`
          : state.accentElsewhere
            ? `${looks}. One phrase per headline: this moves it here`
            : `${looks}. One phrase per headline`
      }
      pressed={state.accent === style}
      disabled={!fits && state.accent !== style}
      onPress={() => onCommand({ type: 'accent', style })}
    >
      {name}
    </BarButton>
  ))
  if (!colours) return <Row>{marks}</Row>
  return (
    <>
      <Row>
        {marks}
        <Divider />
        <MoreButton open={more} onPress={onMore} />
      </Row>
      {more && (
        <Row>
          {roles.map(({ role, name, colour }) => (
            <BarButton
              key={role}
              label={`Phrase in ${name.toLowerCase()}`}
              tip={`The phrase in ${name.toLowerCase()}`}
              pressed={(state.accentColour ?? 'accent') === role}
              onPress={() => onCommand({ type: 'accentColour', role })}
            >
              <Swatch colour={colour} className="rounded-full" />
            </BarButton>
          ))}
        </Row>
      )}
    </>
  )
}

const ALIGNS: ReadonlyArray<{ align: WordsAlign; label: string; Icon: typeof Bars3Icon }> = [
  { align: 'start', label: WORDS.alignment.start, Icon: Bars3BottomLeftIcon },
  { align: 'center', label: WORDS.alignment.centre, Icon: Bars3Icon },
  { align: 'end', label: WORDS.alignment.end, Icon: Bars3BottomRightIcon },
]

function RichMarks({
  state,
  onCommand,
  onLink,
  roles,
  more,
  onMore,
}: {
  state: WordsState
  onCommand: (command: WordsCommand) => void
  onLink: () => void
  roles: readonly WordsRole[]
  more: boolean
  onMore: () => void
}) {
  const inList = state.bulletList || state.orderedList
  return (
    <>
      <Row>
        <BarButton
          label="Bold"
          tip={`Bold (${MOD}B)`}
          pressed={state.bold}
          onPress={() => onCommand({ type: 'bold' })}
        >
          <BoldIcon className="size-4" />
        </BarButton>
        <BarButton
          label="Italic"
          tip={`Italic (${MOD}I)`}
          pressed={state.italic}
          onPress={() => onCommand({ type: 'italic' })}
        >
          <ItalicIcon className="size-4" />
        </BarButton>
        {state.link ? (
          <BarButton
            label="Remove link"
            tip={state.link}
            onPress={() => onCommand({ type: 'unlink' })}
          >
            <LinkSlashIcon className="size-4" />
          </BarButton>
        ) : (
          <BarButton label="Link" tip={`Link (${MOD}K)`} onPress={onLink}>
            <LinkIcon className="size-4" />
          </BarButton>
        )}
        <Divider />
        <BarButton
          label="Bulleted list"
          tip="Bulleted list"
          pressed={state.bulletList}
          onPress={() => onCommand({ type: 'bulletList' })}
        >
          <ListBulletIcon className="size-4" />
        </BarButton>
        <BarButton
          label="Numbered list"
          tip="Numbered list"
          pressed={state.orderedList}
          onPress={() => onCommand({ type: 'orderedList' })}
        >
          <NumberedListIcon className="size-4" />
        </BarButton>
        <Divider />
        <MoreButton open={more} onPress={onMore} />
      </Row>
      {more && (
        <Row>
          <BarButton
            label={WORDS.paragraph}
            tip={WORDS.paragraph}
            pressed={state.heading === 0}
            disabled={inList}
            onPress={() => onCommand({ type: 'heading', level: 0 })}
          >
            <span className="text-[12px]">Aa</span>
          </BarButton>
          {([2, 3] as const).map((level) => (
            <BarButton
              key={level}
              label={`Heading ${level}`}
              tip={inList ? 'Lists hold no headings' : `Heading ${level}`}
              pressed={state.heading === level}
              disabled={inList}
              onPress={() => onCommand({ type: 'heading', level })}
            >
              {level === 2 ? <H2Icon className="size-4" /> : <H3Icon className="size-4" />}
            </BarButton>
          ))}
          <Divider />
          {ALIGNS.map(({ align, label, Icon }) => (
            <BarButton
              key={align}
              label={label}
              tip={label}
              pressed={state.align === align}
              disabled={inList}
              onPress={() => onCommand({ type: 'align', align })}
            >
              <Icon className="size-4" />
            </BarButton>
          ))}
          {roles.length > 0 && (
            <>
              <Divider />
              <BarButton
                label="Text colour"
                tip="The text’s own colour"
                pressed={state.colour === null}
                onPress={() => onCommand({ type: 'colour', role: null })}
              >
                <Swatch colour="currentColor" className="rounded-full" />
              </BarButton>
              {roles.map(({ role, name, colour }) => (
                <BarButton
                  key={role}
                  label={name}
                  tip={`In ${name.toLowerCase()}, made to read where it sits`}
                  pressed={state.colour === role}
                  onPress={() => onCommand({ type: 'colour', role })}
                >
                  <Swatch colour={colour} className="rounded-full" />
                </BarButton>
              ))}
            </>
          )}
        </Row>
      )}
    </>
  )
}

/** A web or email address for the selected words; Enter sets it, Escape goes back. */
function LinkField({
  current,
  onDone,
}: {
  current: string | null
  onDone: (href: string | null) => void
}) {
  const id = useId()
  const [typed, setTyped] = useState(current ?? '')
  const [wrong, setWrong] = useState(false)
  return (
    <div className="flex items-center gap-1 px-1">
      <label htmlFor={id} className="sr-only">
        Link address
      </label>
      <input
        id={id}
        autoFocus
        value={typed}
        placeholder="https://"
        aria-invalid={wrong || undefined}
        aria-describedby={wrong ? `${id}-wrong` : undefined}
        onChange={(event) => {
          setTyped(event.target.value)
          setWrong(false)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          const href = hrefOf(typed)
          if (href) onDone(href)
          else setWrong(true)
        }}
        className="h-7 w-56 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {wrong && (
        <span id={`${id}-wrong`} className="text-[12px] text-destructive">
          A web or email address
        </span>
      )}
    </div>
  )
}

function BarButton({
  label,
  tip,
  pressed,
  expanded,
  disabled,
  onPress,
  children,
}: {
  label: string
  tip: string
  pressed?: boolean
  expanded?: boolean
  disabled?: boolean
  onPress: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed === undefined ? undefined : pressed}
          aria-expanded={expanded}
          disabled={disabled}
          // Clicking keeps the words' selection and focus.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPress}
          className={cn(
            'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[13px] font-medium',
            'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            'disabled:pointer-events-none disabled:opacity-40',
            (pressed || expanded) && 'bg-accent text-accent-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
