import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { SupportedLocale } from '@/lib/shared/i18n'
import { languageName } from '@/components/admin/settings/appearance/language-picker'
import { sameWords as same, type WordsDoc, type WordsKind } from '@/lib/shared/design/rich-words'
import type { WordsRole } from '@/lib/shared/design/colour-roles'
import { runWordsCommand, wordsExtensions, wordsState } from '@/lib/shared/words-editor/extensions'
import { cn } from '@/lib/shared/utils'
import { WordsBubble } from './words-bubble'

/** How each kind says what it takes, for people using a screen reader. */
const HOW: Record<WordsKind, string> = {
  headline:
    'Select words to set them apart as Accent, Highlight or Lighter; Alt+F10 opens the format bar. Enter keeps, Escape undoes.',
  plain: 'Enter keeps, Escape undoes.',
  rich: 'Select words to format them; Alt+F10 opens the format bar. Escape undoes.',
}

/**
 * A field of the portal's words in the panel: the same editor as on the
 * canvas, with the same schema for its kind, so a headline's phrase is set
 * apart by selecting it rather than typed again elsewhere. Each edit goes to
 * the design as it is typed; Escape puts back what was there when the field
 * took focus. A quiet count shows near the limit, and the same words in the
 * other languages show beneath.
 */
export function WordsField({
  label,
  kind,
  value,
  onChange,
  placeholder,
  limit = null,
  elsewhere = [],
  roles = [],
  autoFocus = false,
  className,
}: {
  label: string
  kind: WordsKind
  value: WordsDoc
  onChange: (doc: WordsDoc) => void
  placeholder?: string
  limit?: number | null
  /** The same words in other languages, as a hint. */
  elsewhere?: ReadonlyArray<{ locale: string; text: string }>
  /** The brand's colour roles words may be drawn in. */
  roles?: readonly WordsRole[]
  autoFocus?: boolean
  className?: string
}) {
  const id = useId()
  const latest = useRef({ value, onChange })
  latest.current = { value, onChange }
  // What the field held when it took focus, which Escape puts back.
  const before = useRef<WordsDoc | null>(null)
  const [toolbar, setToolbar] = useState(0)
  const [linkAsked, setLinkAsked] = useState(0)
  // Tiptap compares its options by reference and reconfigures the editor on every render that
  // passes new ones, so the extensions and props are made once for the field's kind and limit.
  // The hooks read the latest value through refs; a new kind, limit or placeholder makes a new editor.
  const extensions = useMemo(
    () =>
      wordsExtensions({
        kind,
        limit,
        placeholder,
        onCommit: (own) => {
          own.commands.blur()
        },
        onCancel: (own) => {
          const was = before.current
          if (was && !same(was, latest.current.value)) {
            own.commands.setContent(was, { emitUpdate: false })
            latest.current.onChange(was)
          }
          own.commands.blur()
        },
        onLinkRequest: () => setLinkAsked((n) => n + 1),
        onToolbar: () => setToolbar((n) => n + 1),
      }),
    [kind, limit, placeholder]
  )
  const editorProps = useMemo(
    () => ({
      attributes: {
        id,
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': String(kind === 'rich'),
        'aria-description': HOW[kind],
        class: cn(
          'min-h-9 w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20',
          '[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground [&_.is-empty]:before:content-[attr(data-placeholder)]',
          kind === 'rich' &&
            'min-h-24 [&_a]:underline [&_ol]:list-decimal [&_ol]:ps-5 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:ps-5'
        ),
      },
    }),
    [id, label, kind]
  )
  // The words the editor starts from, kept for its life: the value effect below shows later ones.
  const initial = useMemo(() => latest.current.value, [extensions])
  const editor = useEditor(
    {
      immediatelyRender: false,
      content: initial,
      autofocus: autoFocus ? 'end' : false,
      extensions,
      editorProps,
      onFocus: ({ editor: focused }) => {
        before.current = focused.getJSON() as WordsDoc
      },
      // Leaving the field shows the words as the design keeps them.
      onBlur: ({ editor: left, event }) => {
        if ((event.relatedTarget as Element | null)?.closest?.('[data-words-bubble]')) return
        before.current = null
        if (!same(left.getJSON(), latest.current.value))
          left.commands.setContent(latest.current.value, { emitUpdate: false })
      },
      onUpdate: ({ editor: changed }) => {
        before.current ??= latest.current.value
        const doc = changed.getJSON() as WordsDoc
        if (!same(doc, latest.current.value)) latest.current.onChange(doc)
      },
    },
    [extensions]
  )

  // Words changed elsewhere (undo, the canvas, Quackback AI) show here. Not while typing:
  // the design keeps a line trimmed, and a space just typed must stay until the field is left.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused || same(editor.getJSON(), value)) return
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? wordsState(current, kind, limit) : null),
  })
  const near = !!limit && !!state && state.length >= limit * 0.8

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      <div
        // The accent's looks in the builder's own colours, as the portal draws them in the brand's.
        className="relative [--qb-band-accent:var(--primary)] [--qb-band-highlight:color-mix(in_oklab,var(--primary)_28%,transparent)]"
        // The brand's colours as the words draw them, for words and phrases in a colour role.
        style={Object.fromEntries(
          roles.map(({ role, colour }) => [
            role === 'accent' ? '--qb-words-accent' : `--qb-role-${role}`,
            colour,
          ])
        )}
        data-words-field={kind}
      >
        <EditorContent editor={editor} />
        {near && (
          <span
            aria-live="polite"
            data-words-count=""
            className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
          >
            {state.length}/{limit}
          </span>
        )}
      </div>
      {editor && kind !== 'plain' && state && (
        <BubbleMenu
          editor={editor}
          options={{ strategy: 'fixed', placement: 'top' }}
          shouldShow={({ editor: current, state: now }) =>
            !now.selection.empty && (current.isFocused || toolbar > 0 || linkAsked > 0)
          }
        >
          <WordsBubble
            key={toolbar}
            state={state}
            roles={roles}
            focusOnMount={toolbar > 0}
            linkRequested={linkAsked}
            onCommand={(command) => runWordsCommand(editor, command)}
            onReturn={() => {
              setToolbar(0)
              editor.commands.focus()
            }}
          />
        </BubbleMenu>
      )}
      {elsewhere.length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          {elsewhere.map(({ locale, text }, index) => (
            <span key={locale}>
              {index > 0 && ' · '}
              {languageName(locale as SupportedLocale)}: “{text}”
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
