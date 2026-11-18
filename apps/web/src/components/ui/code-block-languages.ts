/**
 * The grammars code blocks highlight with. loadCodeLanguages in
 * code-block-highlight.ts loads this module the first time an editor's
 * document holds a code block, so editors that never show one, like the
 * widget's composers, never download them.
 */
import type { createLowlight } from 'lowlight'
import langBash from 'highlight.js/lib/languages/bash'
import langC from 'highlight.js/lib/languages/c'
import langCss from 'highlight.js/lib/languages/css'
import langDiff from 'highlight.js/lib/languages/diff'
import langGo from 'highlight.js/lib/languages/go'
import langJava from 'highlight.js/lib/languages/java'
import langJavascript from 'highlight.js/lib/languages/javascript'
import langJson from 'highlight.js/lib/languages/json'
import langPhp from 'highlight.js/lib/languages/php'
import langPlaintext from 'highlight.js/lib/languages/plaintext'
import langPython from 'highlight.js/lib/languages/python'
import langRuby from 'highlight.js/lib/languages/ruby'
import langRust from 'highlight.js/lib/languages/rust'
import langShell from 'highlight.js/lib/languages/shell'
import langSql from 'highlight.js/lib/languages/sql'
import langTypescript from 'highlight.js/lib/languages/typescript'
import langXml from 'highlight.js/lib/languages/xml'
import langYaml from 'highlight.js/lib/languages/yaml'

type Lowlight = ReturnType<typeof createLowlight>

// Curated grammar set instead of lowlight's `common` (~37 languages):
// registration is limited to languages that actually appear in support and
// product content. An unregistered language renders as plain text inside the
// code block.
export function registerCodeLanguages(lowlight: Lowlight): void {
  lowlight.register({
    bash: langBash,
    c: langC,
    css: langCss,
    diff: langDiff,
    go: langGo,
    java: langJava,
    javascript: langJavascript,
    json: langJson,
    php: langPhp,
    plaintext: langPlaintext,
    python: langPython,
    ruby: langRuby,
    rust: langRust,
    shell: langShell,
    sql: langSql,
    typescript: langTypescript,
    xml: langXml,
    yaml: langYaml,
  })
  // Fence aliases people actually type (```js, ```html, ```sh …): without
  // these an aliased block silently falls back to plain text.
  lowlight.registerAlias({
    bash: ['sh', 'zsh'],
    javascript: ['js', 'jsx', 'node'],
    python: ['py'],
    ruby: ['rb'],
    typescript: ['ts', 'tsx'],
    xml: ['html', 'svg'],
    yaml: ['yml'],
  })
}
