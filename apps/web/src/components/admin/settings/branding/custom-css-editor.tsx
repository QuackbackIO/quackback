import CodeMirror from '@uiw/react-codemirror'
import { css } from '@codemirror/lang-css'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { cn } from '@/lib/shared/utils'
import { oklchColor } from '@/components/admin/settings/branding/oklch-color-extension'

// ==============================================
// Custom CodeMirror theme using admin portal CSS variables
// ==============================================
const adminEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: '0.75rem',
    lineHeight: '1.625',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 20%, transparent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: 'var(--muted-foreground)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) - 2px)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 30%, transparent)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 15%, transparent)',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
    outline: 'none',
  },
  '.cm-placeholder': {
    color: 'var(--muted-foreground)',
  },
})

const adminHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--primary)' },
    { tag: tags.propertyName, color: 'var(--chart-1, var(--primary))' },
    { tag: [tags.string, tags.inserted], color: 'var(--chart-5, var(--primary))' },
    { tag: [tags.number, tags.color], color: 'var(--chart-4, var(--primary))' },
    { tag: [tags.className, tags.tagName], color: 'var(--chart-2, var(--primary))' },
    { tag: tags.punctuation, color: 'var(--muted-foreground)' },
    { tag: tags.separator, color: 'var(--muted-foreground)' },
    { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
    { tag: tags.invalid, color: 'var(--destructive)' },
  ])
)

const adminEditorExtensions = [css(), oklchColor, adminEditorTheme, adminHighlightStyle]

export const CUSTOM_CSS_EDITOR_HEIGHT = '280px'

interface CustomCssEditorProps {
  value: string
  onChange: (value: string) => void
}

/**
 * The branding page's "Advanced CSS" editor. Isolated into its own chunk
 * (loaded via React.lazy from settings.branding.tsx) because
 * @uiw/react-codemirror + @codemirror/lang-css make the branding route the
 * largest chunk in the app, yet most visits never open this panel.
 */
export function CustomCssEditor({ value, onChange }: CustomCssEditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      height={CUSTOM_CSS_EDITOR_HEIGHT}
      theme="none"
      extensions={adminEditorExtensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        tabSize: 2,
      }}
      className={cn(
        'overflow-hidden rounded-md border border-input bg-background',
        '[&_.cm-editor]:!outline-none',
        '[&_.cm-editor.cm-focused]:ring-1 [&_.cm-editor.cm-focused]:ring-ring',
        '[&_.cm-scroller]:overflow-auto'
      )}
    />
  )
}

export default CustomCssEditor
