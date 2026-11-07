import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The body of one of globals.css's named portal utilities (`@utility <name>`),
 * for tests of markup whose design variants live there rather than in class
 * strings.
 */
export function portalUtility(name: string): string {
  const css = readFileSync(resolve(__dirname, '../globals.css'), 'utf8')
  const start = css.indexOf(`@utility ${name} {`)
  if (start < 0) throw new Error(`no @utility ${name} in globals.css`)
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1)
  }
  throw new Error(`@utility ${name} is not closed`)
}
