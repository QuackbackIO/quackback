/**
 * CodeMirror extension that adds inline color swatches for oklch() values.
 * Uses native CSS oklch rendering for the swatch, and converts to/from hex
 * for the browser's color picker.
 */
import { ViewPlugin, EditorView, WidgetType, Decoration } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { hexToOklch, oklchToHex } from '@/lib/shared/theme'

const OKLCH_RE = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/

class OklchColorWidget extends WidgetType {
  constructor(
    readonly oklchRaw: string,
    readonly from: number,
    readonly to: number
  ) {
    super()
  }

  eq(other: OklchColorWidget) {
    return this.oklchRaw === other.oklchRaw && this.from === other.from
  }

  toDOM() {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-oklch-swatch'
    wrapper.style.backgroundColor = this.oklchRaw

    const picker = document.createElement('input')
    picker.type = 'color'
    picker.value = oklchToHex(this.oklchRaw)
    picker.dataset['from'] = String(this.from)
    picker.dataset['to'] = String(this.to)
    picker.dataset['oklchraw'] = this.oklchRaw

    wrapper.appendChild(picker)
    return wrapper
  }

  ignoreEvent() {
    return false
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const widgets: Array<ReturnType<Decoration['range']>> = []

  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter: ({ type, from, to }) => {
        if (type.name !== 'CallExpression') return
        const text = view.state.doc.sliceString(from, to)
        if (!text.startsWith('oklch')) return
        const match = OKLCH_RE.exec(text)
        if (!match) return

        const widget = Decoration.widget({
          widget: new OklchColorWidget(match[0], from, to),
          side: 0,
        })
        widgets.push(widget.range(from))
      },
    })
  }

  return Decoration.set(widgets)
}

const oklchColorView = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      change: (e, view) => {
        const target = e.target as HTMLInputElement
        if (target.nodeName !== 'INPUT' || target.type !== 'color') return false
        if (!target.dataset['from'] || !target.dataset['to']) return false

        const from = Number(target.dataset['from'])
        const to = Number(target.dataset['to'])
        const newOklch = hexToOklch(target.value)

        view.dispatch({ changes: { from, to, insert: newOklch } })
        return true
      },
    },
  }
)

const oklchColorTheme = EditorView.baseTheme({
  '.cm-oklch-swatch': {
    width: '12px',
    height: '12px',
    display: 'inline-block',
    borderRadius: '2px',
    marginRight: '0.5ch',
    outline: '1px solid #00000040',
    overflow: 'hidden',
    verticalAlign: 'middle',
    marginTop: '-2px',
  },
  '.cm-oklch-swatch input[type="color"]': {
    background: 'transparent',
    display: 'block',
    border: 'none',
    outline: '0',
    paddingLeft: '24px',
    height: '12px',
    cursor: 'pointer',
  },
  '.cm-oklch-swatch input[type="color"]::-webkit-color-swatch': {
    border: 'none',
    paddingLeft: '24px',
  },
})

export const oklchColor = [oklchColorView, oklchColorTheme]
