/** Decode one top-level JSON string incrementally, without reparsing earlier tokens. */
export class StreamedJsonText {
  text = ''
  private depth = 0
  private stringRole: 'key' | 'text' | 'other' | null = null
  private keyExpected = false
  private valueExpected = false
  private key = ''
  private escaped = false
  private unicode: string | null = null
  private started = false
  private invalid = false
  constructor(private readonly field: string) {}

  append(chunk: string): { delta: string; text: string } {
    const output: string[] = []
    const emit = (value: string) => {
      if (this.stringRole === 'key') this.key += value
      if (this.stringRole === 'text') output.push(value)
    }
    for (const character of chunk) {
      if (this.invalid) break
      if (!this.started) {
        if (/\s/.test(character)) continue
        if (character !== '{') {
          this.invalid = true
          break
        }
        this.started = true
      }
      if (this.stringRole) {
        if (this.unicode !== null) {
          this.unicode += character
          if (this.unicode.length === 4) {
            if (/^[0-9a-f]{4}$/i.test(this.unicode))
              emit(String.fromCharCode(parseInt(this.unicode, 16)))
            this.unicode = null
          }
        } else if (this.escaped) {
          this.escaped = false
          if (character === 'u') this.unicode = ''
          else
            emit(
              (
                {
                  '"': '"',
                  '\\': '\\',
                  '/': '/',
                  b: '\b',
                  f: '\f',
                  n: '\n',
                  r: '\r',
                  t: '\t',
                } as Record<string, string>
              )[character] ?? ''
            )
        } else if (character === '\\') this.escaped = true
        else if (character === '"') this.stringRole = null
        else emit(character)
        continue
      }
      if (character === '"') {
        this.stringRole =
          this.depth === 1 && this.keyExpected
            ? 'key'
            : this.depth === 1 && this.valueExpected && this.key === this.field
              ? 'text'
              : 'other'
        if (this.stringRole === 'key') this.key = ''
        this.keyExpected = false
        this.valueExpected = false
      } else if (character === '{' || character === '[') {
        this.depth++
        this.valueExpected = false
        if (this.depth === 1 && character === '{') this.keyExpected = true
      } else if (character === '}' || character === ']') this.depth--
      else if (this.depth === 1 && character === ',') {
        this.keyExpected = true
        this.valueExpected = false
      } else if (this.depth === 1 && character === ':') this.valueExpected = true
      else if (!/\s/.test(character)) this.valueExpected = false
    }
    const delta = output.join('')
    this.text += delta
    return { delta, text: this.text }
  }
}
