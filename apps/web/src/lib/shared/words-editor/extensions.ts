/**
 * The words editor's schema per kind of words, so nothing can be typed or
 * pasted that the portal does not draw: a headline holds one line with one
 * phrase set apart (in a colour role of its own, if chosen), plain words one
 * line with no marks, and rich words paragraphs, H2 and H3 headings, line
 * breaks, bold, italic, links, lists, alignment and colours from the brand's
 * colour roles. No word takes a size of its own. One set of
 * extensions for both places words are edited: on the canvas, inside the
 * portal's frame, and in the builder's panel; and the schema the design's
 * words are checked against, on the server too (words-schema.ts). It needs
 * no DOM to be imported.
 */
import { Extension, Mark, Node, mergeAttributes, type Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Heading from '@tiptap/extension-heading'
import Link from '@tiptap/extension-link'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Fragment, Slice, type Mark as PMMark, type Node as PMNode } from '@tiptap/pm/model'
import { ACCENT_CLASS } from '@/lib/shared/design/accent-class'
import {
  ACCENT_MAX,
  isAllowedHref,
  isColourRole,
  isRichAlign,
  RICH_HEADINGS,
  wordsColour,
  type AccentStyle,
  type ColourRole,
  type WordsAlign,
  type WordsKind,
} from '@/lib/shared/design/rich-words'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    accent: {
      /** Sets the selected words apart in a style; the headline's one phrase moves here. */
      setAccent: (style: AccentStyle) => ReturnType
      /** Leaves the headline with no phrase set apart. */
      unsetAccent: () => ReturnType
      /** Draws the headline's phrase in a colour role; the brand colour is its own. */
      setAccentColour: (role: ColourRole) => ReturnType
    }
  }
}

const STYLES = Object.keys(ACCENT_CLASS) as AccentStyle[]

/**
 * An attribute's rule, as the schema checks stored words against it: a value
 * that breaks it makes the words invalid, so they are fitted before they are kept.
 */
const rule =
  (what: string, holds: (value: unknown) => boolean) =>
  (value: unknown): void => {
    if (!holds(value)) throw new RangeError(`${what} cannot be ${JSON.stringify(value)}`)
  }

/** A headline's phrase set apart, drawn with the portal's own classes. One per headline. */
export const AccentMark = Mark.create({
  name: 'accent',
  inclusive: false,
  addAttributes() {
    return {
      style: {
        default: 'colour',
        validate: rule('An accent style', (value) => STYLES.includes(value as AccentStyle)),
        parseHTML: (element) => {
          const style = element.getAttribute('data-qb-accent')
          return STYLES.includes(style as AccentStyle) ? style : 'colour'
        },
        renderHTML: (attributes) => {
          const style = attributes.style as AccentStyle
          return { 'data-qb-accent': style, class: ACCENT_CLASS[style] ?? ACCENT_CLASS.colour }
        },
      },
      colour: {
        default: null,
        validate: rule(
          "An accent's colour",
          (value) => value === null || (isColourRole(value) && value !== 'accent')
        ),
        parseHTML: (element) => {
          const role = element.getAttribute('data-qb-accent-colour')
          return isColourRole(role) && role !== 'accent' ? role : null
        },
        renderHTML: (attributes) => {
          const role = attributes.colour as unknown
          if (!isColourRole(role) || role === 'accent') return {}
          // While the words are open, the role's colour as the band reads it, or as it is.
          const colour = `var(--qb-band-accent-${role}, var(--qb-role-${role}))`
          return {
            'data-qb-accent-colour': role,
            style:
              attributes.style === 'highlight'
                ? `--qb-band-highlight: color-mix(in oklch, ${colour} 35%, transparent)`
                : attributes.style === 'colour'
                  ? `color: ${colour}`
                  : null,
          }
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-qb-accent]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
  addCommands() {
    return {
      setAccent:
        (style) =>
        ({ tr, state, dispatch }) => {
          const { from, to, empty } = state.selection
          if (empty) return false
          const type = state.schema.marks.accent!
          if (dispatch) {
            // A phrase moved keeps the colour the headline's phrase was drawn in.
            const colour = accentMarkOf(state.doc)?.attrs.colour ?? null
            tr.removeMark(0, state.doc.content.size, type)
            tr.addMark(from, to, type.create({ style, colour }))
            dispatch(tr)
          }
          return true
        },
      setAccentColour:
        (role) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.marks.accent!
          if (!accentMarkOf(state.doc)) return false
          if (dispatch) {
            state.doc.descendants((node, pos) => {
              const mark = node.isText ? type.isInSet(node.marks) : undefined
              if (!mark) return
              const end = pos + node.nodeSize
              tr.removeMark(pos, end, type)
              tr.addMark(
                pos,
                end,
                type.create({ ...mark.attrs, colour: role === 'accent' ? null : role })
              )
            })
            dispatch(tr)
          }
          return true
        },
      unsetAccent:
        () =>
        ({ tr, state, dispatch }) => {
          if (dispatch)
            dispatch(tr.removeMark(0, state.doc.content.size, state.schema.marks.accent!))
          return true
        },
    }
  },
})

/** The headline's accent mark, wherever it is. */
function accentMarkOf(doc: PMNode) {
  let found: PMMark | undefined
  doc.descendants((node) => {
    found ??= node.marks.find((mark) => mark.type.name === 'accent')
  })
  return found
}

/** Words in one of the brand's colour roles: never a free colour. */
export const ColourMark = Mark.create({
  name: 'colour',
  addAttributes() {
    return {
      role: {
        default: 'accent',
        validate: rule('A colour role', isColourRole),
        parseHTML: (element) => {
          const role = element.getAttribute('data-qb-colour')
          return isColourRole(role) ? role : 'accent'
        },
        renderHTML: (attributes) => {
          const role = isColourRole(attributes.role) ? attributes.role : 'accent'
          return { 'data-qb-colour': role, style: `color: ${wordsColour(role)}` }
        },
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-qb-colour]',
        getAttrs: (element) =>
          isColourRole(element.getAttribute('data-qb-colour')) ? null : false,
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  },
})

/** Paragraphs and headings set to the start (unset), the centre or the end. */
const WordsAlignment = Extension.create({
  name: 'wordsAlign',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          textAlign: {
            default: null,
            validate: rule('An alignment', (value) => value === null || isRichAlign(value)),
            parseHTML: (element) => {
              const align = element.style.textAlign
              return isRichAlign(align) ? align : null
            },
            renderHTML: (attributes) =>
              isRichAlign(attributes.textAlign)
                ? { style: `text-align: ${attributes.textAlign}` }
                : {},
          },
        },
      },
    ]
  },
})

/** Rich words' headings: H2 and H3 only. */
const WordsHeading = Heading.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {}
    return {
      ...parent,
      level: {
        ...parent.level,
        validate: rule('A heading level', (value) =>
          (RICH_HEADINGS as readonly unknown[]).includes(value)
        ),
      },
    }
  },
}).configure({ levels: [...RICH_HEADINGS] })

/** Rich words' links: a web address or an email, nothing a page would run. */
const WordsLink = Link.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {}
    return { ...parent, href: { ...parent.href, validate: rule('A link', isAllowedHref) } }
  },
}).configure({
  openOnClick: false,
  autolink: false,
  linkOnPaste: true,
  protocols: ['mailto'],
  isAllowedUri: (url) => isAllowedHref(url),
  HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
})

/** A document of one paragraph: a line of words. */
const OneLine = Node.create({ name: 'doc', topNode: true, content: 'paragraph' })

/** What the editor's owner hears: a kept edit, a cancelled one, and a link asked for. */
export interface WordsEditorHooks {
  /** Enter on a line, or Mod-Enter in rich words. */
  onCommit?: (editor: Editor) => void
  /** Escape. */
  onCancel?: (editor: Editor) => void
  /** Mod-K in rich words: the owner asks for an address. */
  onLinkRequest?: (editor: Editor) => void
  /** Alt-F10: the owner moves focus to the format bar. */
  onToolbar?: (editor: Editor) => void
}

/** The keys a words editor answers: Enter keeps a line, Escape cancels, Mod-K asks for a link. */
function wordsKeys(kind: WordsKind, hooks: WordsEditorHooks) {
  return Extension.create({
    name: 'wordsKeys',
    priority: 1000,
    addKeyboardShortcuts() {
      const commit = (): boolean => {
        hooks.onCommit?.(this.editor)
        return true
      }
      const keys: Record<string, () => boolean> = {
        Escape: () => {
          hooks.onCancel?.(this.editor)
          return true
        },
        'Mod-Enter': commit,
        'Alt-F10': () => {
          hooks.onToolbar?.(this.editor)
          return true
        },
      }
      if (kind !== 'rich') {
        keys.Enter = commit
        keys['Shift-Enter'] = commit
      } else
        keys['Mod-k'] = () => {
          hooks.onLinkRequest?.(this.editor)
          return true
        }
      return keys
    },
  })
}

/**
 * Whether a change keeps the words within their limit: one that passes it is
 * not made, unless it shortens them, and never while a composition (an input
 * method's words in the making) is under way, which a refused change would
 * break: the composed words are cut to the limit once it ends.
 */
export function withinLimit(
  tr: Transaction,
  state: EditorState,
  limit: number,
  composing: boolean
): boolean {
  if (!tr.docChanged || composing || tr.getMeta('composition') !== undefined) return true
  const next = tr.doc.textContent.length
  return next <= limit || next <= state.doc.textContent.length
}

/**
 * The change that cuts words over their limit back to it, or null when they
 * are within it: the characters over go from just before the cursor, where
 * the words just composed end, else from the end of the words.
 */
export function cutToLimit(state: EditorState, limit: number): Transaction | null {
  const over = state.doc.textContent.length - limit
  if (over <= 0) return null
  const { $head } = state.selection
  const before = $head.parent.isTextblock ? $head.parentOffset : 0
  if (
    before >= over &&
    $head.parent.textBetween($head.parentOffset - over, $head.parentOffset).length === over
  )
    return state.tr.delete($head.pos - over, $head.pos)
  // Else from the end: a line's words past the limit (lines alone have limits).
  let seen = 0
  let at: number | null = null
  state.doc.descendants((node, pos) => {
    if (at !== null) return false
    if (!node.isText) return true
    const length = node.text!.length
    if (seen + length > limit) at = pos + (limit - seen)
    seen += length
    return false
  })
  return at === null ? null : state.tr.delete(at, state.doc.content.size - 1)
}

/**
 * Keeps the words within a limit of characters: a change that would pass it
 * is not made, and a paste is cut to the room left. While an input method
 * composes, nothing is refused; the words are cut to the limit when it ends.
 */
function wordsLimit(limit: number) {
  return Extension.create({
    name: 'wordsLimit',
    addProseMirrorPlugins() {
      let view: EditorView | null = null
      const cut = () => {
        if (!view || view.isDestroyed || view.composing) return
        const tr = cutToLimit(view.state, limit)
        if (tr) view.dispatch(tr)
      }
      return [
        new Plugin({
          key: new PluginKey('wordsLimit'),
          view: (editorView) => {
            view = editorView
            return {
              destroy: () => {
                view = null
              },
            }
          },
          filterTransaction: (tr, state) => withinLimit(tr, state, limit, !!view?.composing),
          // The composed words kept after the composition ended, cut to the limit.
          appendTransaction: (trs, _, state) =>
            !view?.composing && trs.some((tr) => tr.getMeta('composition') !== undefined)
              ? cutToLimit(state, limit)
              : null,
          props: {
            handleDOMEvents: {
              // The input method may finish its words a moment after it says it ended.
              compositionend: () => {
                setTimeout(cut, 0)
                setTimeout(cut, 50)
                return false
              },
            },
          },
        }),
      ]
    },
  })
}

/** Pasting into a line: its text alone, on one line, cut to the room left. */
function linePaste(limit: number | null) {
  return Extension.create({
    name: 'linePaste',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('linePaste'),
          props: {
            transformPasted: (slice, view) => {
              const text = slice.content.textBetween(0, slice.content.size, ' ', ' ')
              const { from, to } = view.state.selection
              const room =
                limit === null ? Infinity : limit - view.state.doc.textContent.length + (to - from)
              const line = text.replace(/\s+/g, ' ').slice(0, Math.max(0, room))
              return line
                ? new Slice(Fragment.from(view.state.schema.text(line)), 0, 0)
                : Slice.empty
            },
          },
        }),
      ]
    },
  })
}

export interface WordsEditorOptions extends WordsEditorHooks {
  kind: WordsKind
  placeholder?: string
  limit?: number | null
}

/** The extensions for one kind of words. */
export function wordsExtensions(options: WordsEditorOptions) {
  const { kind, placeholder, limit = null } = options
  const rich = kind === 'rich'
  const none = false as const
  const kit = StarterKit.configure({
    document: rich ? undefined : none,
    blockquote: none,
    code: none,
    codeBlock: none,
    heading: none,
    horizontalRule: none,
    strike: none,
    underline: none,
    dropcursor: none,
    gapcursor: none,
    trailingNode: none,
    bold: rich ? {} : none,
    italic: rich ? {} : none,
    hardBreak: rich ? {} : none,
    bulletList: rich ? {} : none,
    orderedList: rich ? {} : none,
    listItem: rich ? {} : none,
    listKeymap: rich ? {} : none,
    link: none,
  })
  return [
    kit,
    ...(rich ? [] : [OneLine, linePaste(limit)]),
    ...(kind === 'headline' ? [AccentMark] : []),
    ...(rich ? [WordsHeading, WordsLink, ColourMark, WordsAlignment] : []),
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ...(limit ? [wordsLimit(limit)] : []),
    wordsKeys(kind, options),
  ]
}

/* What the format bar shows, and what it asks */

export interface WordsState {
  kind: WordsKind
  /** Whether words are selected, which the format bar needs. */
  selected: boolean
  /** The selected words' characters. */
  selectedLength: number
  /** The style of the phrase set apart where the selection is, if it is. */
  accent: AccentStyle | null
  /** Whether the headline already sets a phrase apart elsewhere. */
  accentElsewhere: boolean
  /** The colour role the headline's phrase is drawn in, when it is not the brand colour. */
  accentColour: ColourRole | null
  bold: boolean
  italic: boolean
  /** The address of the link where the selection is, if any. */
  link: string | null
  bulletList: boolean
  orderedList: boolean
  /** The heading level where the selection is: 0 for a paragraph. */
  heading: 0 | 2 | 3
  /** Where the selected paragraph or heading sits. */
  align: WordsAlign
  /** The colour role of the selected words, if they have one. */
  colour: ColourRole | null
  /** The words' characters, and the most they hold. */
  length: number
  limit: number | null
}

/** What the format bar shows for an editor now. */
export function wordsState(editor: Editor, kind: WordsKind, limit: number | null): WordsState {
  const { state } = editor
  const { from, to, empty } = state.selection
  const accentType = state.schema.marks.accent
  let accent: AccentStyle | null = null
  let accentAnywhere = false
  let accentColour: ColourRole | null = null
  if (accentType) {
    const mark = accentMarkOf(state.doc)
    accentAnywhere = !!mark
    const role = mark?.attrs.colour as unknown
    if (isColourRole(role) && role !== 'accent') accentColour = role
    if (editor.isActive('accent')) accent = editor.getAttributes('accent').style as AccentStyle
  }
  const rich = kind === 'rich'
  const heading = rich
    ? ((RICH_HEADINGS.find((level) => editor.isActive('heading', { level })) ?? 0) as 0 | 2 | 3)
    : 0
  const blockAlign = rich
    ? (editor.getAttributes(heading ? 'heading' : 'paragraph').textAlign as unknown)
    : null
  const role =
    rich && editor.isActive('colour') ? (editor.getAttributes('colour').role as unknown) : null
  return {
    kind,
    selected: !empty,
    selectedLength: state.doc.textBetween(from, to, ' ').length,
    accent,
    accentElsewhere: accentAnywhere && !accent,
    accentColour,
    bold: kind === 'rich' && editor.isActive('bold'),
    italic: kind === 'rich' && editor.isActive('italic'),
    link:
      kind === 'rich' && editor.isActive('link') ? String(editor.getAttributes('link').href) : null,
    bulletList: kind === 'rich' && editor.isActive('bulletList'),
    orderedList: kind === 'rich' && editor.isActive('orderedList'),
    heading,
    align: isRichAlign(blockAlign) ? blockAlign : 'start',
    colour: isColourRole(role) ? role : null,
    length: state.doc.textContent.length,
    limit,
  }
}

/** What the format bar asks of the editor. */
export type WordsCommand =
  | { type: 'accent'; style: AccentStyle }
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'link'; href: string }
  | { type: 'unlink' }
  | { type: 'bulletList' }
  | { type: 'orderedList' }
  /** A paragraph (0), or an H2 or H3 heading. */
  | { type: 'heading'; level: 0 | 2 | 3 }
  | { type: 'align'; align: WordsAlign }
  /** The selected words in a colour role, or (null) in the words' own colour. */
  | { type: 'colour'; role: ColourRole | null }
  /** The headline's phrase in a colour role; the brand colour is its own. */
  | { type: 'accentColour'; role: ColourRole }

/** Whether the selected words can be set apart: up to 60 characters. */
export const accentFits = (state: Pick<WordsState, 'selectedLength'>) =>
  state.selectedLength > 0 && state.selectedLength <= ACCENT_MAX

/** Does what the format bar asks; a style already on the phrase takes it off. */
export function runWordsCommand(editor: Editor, command: WordsCommand): boolean {
  const chain = editor.chain().focus()
  switch (command.type) {
    case 'accent': {
      const on = editor.isActive('accent', { style: command.style })
      if (on) return chain.unsetAccent().run()
      if (editor.state.selection.empty) return false
      if (
        editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)
          .length > ACCENT_MAX
      )
        return false
      return chain.setAccent(command.style).run()
    }
    case 'bold':
      return chain.toggleBold().run()
    case 'italic':
      return chain.toggleItalic().run()
    case 'link':
      if (!isAllowedHref(command.href)) return false
      return chain.extendMarkRange('link').setLink({ href: command.href.trim() }).run()
    case 'unlink':
      return chain.extendMarkRange('link').unsetLink().run()
    case 'bulletList':
      return chain.toggleBulletList().run()
    case 'orderedList':
      return chain.toggleOrderedList().run()
    case 'heading': {
      // The block keeps where it sits as it turns from a paragraph to a heading, or back.
      const from = editor.isActive('heading') ? 'heading' : 'paragraph'
      const textAlign = (editor.getAttributes(from).textAlign as unknown) ?? null
      if (command.level === 0)
        return chain.setParagraph().updateAttributes('paragraph', { textAlign }).run()
      if (!(RICH_HEADINGS as readonly number[]).includes(command.level)) return false
      return chain
        .setHeading({ level: command.level as 2 | 3 })
        .updateAttributes('heading', { textAlign })
        .run()
    }
    case 'align': {
      const textAlign = isRichAlign(command.align) ? command.align : null
      return chain
        .updateAttributes('paragraph', { textAlign })
        .updateAttributes('heading', { textAlign })
        .run()
    }
    case 'colour':
      if (command.role === null) return chain.unsetMark('colour').run()
      if (!isColourRole(command.role)) return false
      return chain.setMark('colour', { role: command.role }).run()
    case 'accentColour':
      if (!isColourRole(command.role)) return false
      return chain.setAccentColour(command.role).run()
  }
}

/** An address as typed: a bare domain gets https://, an email gets mailto:. */
export function hrefOf(typed: string): string | null {
  const text = typed.trim()
  if (!text) return null
  if (isAllowedHref(text)) return text
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `mailto:${text}`
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text)) return `https://${text}`
  return null
}
