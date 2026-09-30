/**
 * The editor's emoji node, with the emoji dataset loaded on demand.
 *
 * `@tiptap/extension-emoji` keeps its ~600 KB shortcode dataset in the same
 * module as its node, so importing the node put the dataset in every editor
 * download, although only the `:` picker, `:shortcode:` and emoticon
 * shortcuts and emoji typed or pasted as characters need it. This node follows
 * that extension's behavior and markup and reads the dataset from
 * `@/lib/shared/content-emoji`, imported the first time the editor gains
 * focus, opens the picker or shows a node stored without its character.
 * Until it arrives those shortcuts leave the text as typed.
 *
 * New nodes store the character in `attrs.emoji` (and the shortcode in
 * `attrs.name`), so rendering one never needs the dataset.
 */
import {
  InputRule,
  Node,
  PasteRule,
  combineTransactionSteps,
  findChildrenInRange,
  getChangedRanges,
  isFirefox,
  mergeAttributes,
  nodeInputRule,
} from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Suggestion, type SuggestionOptions } from '@tiptap/suggestion'
import type { EmojiItem } from '@/lib/shared/content-emoji'
import { recordRecentEmoji } from '@/lib/shared/emoji-recommendations'

type EmojiData = typeof import('@/lib/shared/content-emoji')

let emojiData: EmojiData | null = null
let emojiDataLoad: Promise<EmojiData> | null = null

/** The emoji dataset and its lookups, fetched once, on first need. */
export function loadEmojiData(): Promise<EmojiData> {
  emojiDataLoad ??= import('@/lib/shared/content-emoji').then((data) => (emojiData = data))
  return emojiDataLoad
}

/** A node's character: stored on the node, else looked up by its shortcode. */
function emojiChar(attrs: { name?: unknown; emoji?: unknown }): string | null {
  if (typeof attrs.emoji === 'string' && attrs.emoji) return attrs.emoji
  const name = typeof attrs.name === 'string' ? attrs.name : ''
  return (name && emojiData?.lookupEmoji(name)?.emoji) || null
}

const EmojiSuggestionPluginKey = new PluginKey('emojiSuggestion')

/** `:shortcode:` just typed. */
const shortcodeInputRegex = /:([a-zA-Z0-9_+-]+):$/
/** `:shortcode:` in pasted text. */
const shortcodePasteRegex = /(^|\s):([a-zA-Z0-9_+-]+):/g
/** A two- or three-character word just followed by a space: every bundled emoticon's shape. */
const emoticonInputRegex = /(?:^|\s)(\S{2,3}) $/

/**
 * Fully qualified emoji sequences in typed or pasted text. The `v` flag's
 * `RGI_Emoji` property is missing from older browsers; there emoji characters
 * simply stay text, which renders the same.
 */
const emojiSequence: RegExp | null = (() => {
  try {
    return new RegExp('\\p{RGI_Emoji}', 'gv')
  } catch {
    return null
  }
})()

export interface EmojiNodeOptions {
  HTMLAttributes: Record<string, unknown>
  /** Turn emoticons such as `:)` into emoji once a space follows them. */
  enableEmoticons: boolean
  suggestion: Omit<SuggestionOptions<EmojiItem>, 'editor'>
}

export const EmojiNode = Node.create<EmojiNodeOptions>({
  name: 'emoji',
  inline: true,
  group: 'inline',
  selectable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      enableEmoticons: false,
      suggestion: {
        char: ':',
        pluginKey: EmojiSuggestionPluginKey,
        command: ({ editor, range, props }) => {
          // Swallow the space after the range, so the inserted one is the only one.
          const nodeAfter = editor.view.state.selection.$to.nodeAfter
          if (nodeAfter?.text?.startsWith(' ')) range.to += 1
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: this.name, attrs: { name: props.name, emoji: props.emoji ?? null } },
              { type: 'text', text: ' ' },
            ])
            .command(({ tr, state }) => {
              tr.setStoredMarks(state.doc.resolve(state.selection.to - 2).marks())
              return true
            })
            .run()
        },
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          const type = state.schema.nodes[this.name]
          return !!$from.parent.type.contentMatch.matchType(type)
        },
      },
    }
  },

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element) => element.dataset.name,
        renderHTML: (attributes) => ({ 'data-name': attributes.name }),
      },
      // The Unicode character, persisted so read-only HTML and email render
      // the emoji without the dataset.
      emoji: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const attributes = mergeAttributes(HTMLAttributes, this.options.HTMLAttributes, {
      'data-type': this.name,
    })
    return ['span', attributes, emojiChar(node.attrs) ?? `:${node.attrs.name}:`]
  },

  // A node stored without its character shows `:shortcode:` until the dataset
  // loads, then the emoji, without changing the document.
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('span')
      const attributes = mergeAttributes(HTMLAttributes, this.options.HTMLAttributes, {
        'data-type': this.name,
      })
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== null && value !== undefined) dom.setAttribute(key, String(value))
      }
      const char = emojiChar(node.attrs)
      dom.textContent = char ?? `:${node.attrs.name}:`
      if (!char) {
        void loadEmojiData().then(() => {
          const loaded = emojiChar(node.attrs)
          if (loaded) dom.textContent = loaded
        })
      }
      return { dom, ignoreMutation: (mutation) => mutation.type !== 'selection' }
    }
  },

  renderText({ node }) {
    return emojiChar(node.attrs) ?? `:${node.attrs.name}:`
  },

  renderMarkdown: (node) => (node.attrs?.name ? `:${node.attrs.name}:` : ''),

  onFocus() {
    void loadEmojiData()
  },

  addInputRules() {
    const rules = [
      new InputRule({
        find: shortcodeInputRegex,
        handler: ({ range, match, chain }) => {
          const item = emojiData?.lookupEmoji(match[1])
          if (!item?.emoji) return null
          recordRecentEmoji(item.emoji)
          chain()
            .insertContentAt(range, {
              type: this.name,
              attrs: { name: item.name, emoji: item.emoji },
            })
            .command(({ tr, state }) => {
              tr.setStoredMarks(state.doc.resolve(state.selection.to - 1).marks())
              return true
            })
            .run()
        },
      }),
    ]
    if (this.options.enableEmoticons) {
      // The emoji the handler matched, read back by getAttributes as it inserts.
      let matched: EmojiItem | undefined
      const emoticon = nodeInputRule({
        find: emoticonInputRegex,
        type: this.type,
        getAttributes: () => ({ name: matched?.name ?? null, emoji: matched?.emoji ?? null }),
      })
      rules.push(
        new InputRule({
          find: emoticonInputRegex,
          handler: (props) => {
            matched = emojiData?.emojiForEmoticon(props.match[1])
            return matched ? emoticon.handler(props) : null
          },
        })
      )
    }
    return rules
  },

  addPasteRules() {
    return [
      new PasteRule({
        find: shortcodePasteRegex,
        handler: ({ range, match, chain }) => {
          const prefix = match[1] || ''
          const item = emojiData?.lookupEmoji(match[2])
          if (!item?.emoji) return null
          chain()
            .insertContentAt(
              { from: range.from + prefix.length, to: range.to },
              { type: this.name, attrs: { name: item.name, emoji: item.emoji } },
              { updateSelection: false }
            )
            .command(({ tr, state }) => {
              tr.setStoredMarks(state.doc.resolve(state.selection.to - 1).marks())
              return true
            })
            .run()
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({ editor: this.editor, ...this.options.suggestion }),
      new Plugin({
        key: new PluginKey('emoji'),
        props: {
          // Firefox steps into an inline atom; move over it in one keypress.
          handleKeyDown: (view, event) => {
            if (!isFirefox()) return false
            const isLeft = event.key === 'ArrowLeft'
            const isRight = event.key === 'ArrowRight'
            if (!isLeft && !isRight) return false
            if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false
            const { selection } = view.state
            if (!selection.empty || !(selection instanceof TextSelection)) return false
            const $pos = selection.$from
            if (isLeft) {
              const before = $pos.nodeBefore
              if (!before || before.type !== this.type) return false
              const pos = $pos.pos - before.nodeSize
              if (pos < $pos.start()) return false
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
              return true
            }
            const after = $pos.nodeAfter
            if (!after || after.type !== this.type) return false
            const pos = $pos.pos + after.nodeSize
            if (pos > $pos.end()) return false
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
            return true
          },
          handleDoubleClickOn: (_view, pos, node) => {
            if (node.type !== this.type) return false
            this.editor.commands.setTextSelection({ from: pos, to: pos + node.nodeSize })
            return true
          },
        },
        // Emoji typed or pasted as characters become emoji nodes, as the
        // picker's do, once the dataset has loaded.
        appendTransaction: (transactions, oldState, newState) => {
          if (this.editor.view.composing || !emojiSequence) return
          if (!transactions.some((t) => t.docChanged) || oldState.doc.eq(newState.doc)) return
          const data = emojiData
          if (!data) return
          const { tr } = newState
          const transform = combineTransactionSteps(oldState.doc, [...transactions])
          for (const { newRange } of getChangedRanges(transform)) {
            if (newState.doc.resolve(newRange.from).parent.type.spec.code) continue
            for (const { node, pos } of findChildrenInRange(
              newState.doc,
              newRange,
              (n) => n.isText
            )) {
              if (!node.text) continue
              for (const match of node.text.matchAll(emojiSequence)) {
                if (match.index === undefined) continue
                const item = data.emojiForChar(match[0])
                if (!item?.emoji) continue
                const from = tr.mapping.map(pos + match.index)
                if (newState.doc.resolve(from).parent.type.spec.code) continue
                tr.replaceRangeWith(
                  from,
                  from + match[0].length,
                  this.type.create({ name: item.shortcodes[0] ?? item.name, emoji: item.emoji })
                )
                tr.setStoredMarks(newState.doc.resolve(from).marks())
              }
            }
          }
          return tr.steps.length ? tr : undefined
        },
      }),
    ]
  },
})
