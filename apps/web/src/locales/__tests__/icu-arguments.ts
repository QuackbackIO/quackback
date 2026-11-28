/**
 * The argument names an ICU message uses: `{name}` gives "name", and
 * `{count, plural, ...}` gives "count" plus the arguments inside its branches.
 * A branch's own words (`one {is} other {are}`) are text, never arguments,
 * and neither is the `#` inside one.
 */
export function icuArgumentNames(message: string, into = new Set<string>()): Set<string> {
  for (const body of bracedParts(message)) {
    const [name, kind] = body.split(',').map((part) => part.trim())
    if (name && /^[a-zA-Z_]\w*$/.test(name)) into.add(name)
    if (kind === 'plural' || kind === 'selectordinal' || kind === 'select') {
      const options = body.slice(body.indexOf(',', body.indexOf(',') + 1) + 1)
      for (const branch of bracedParts(options)) icuArgumentNames(branch, into)
    }
  }
  return into
}

/** The text inside each top-level pair of braces. */
function bracedParts(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' && depth++ === 0) start = i + 1
    else if (text[i] === '}' && depth > 0 && --depth === 0) parts.push(text.slice(start, i))
  }
  return parts
}
