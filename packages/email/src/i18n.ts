/**
 * The words of an email in its reader's language.
 *
 * Each template names its words as messages (an id and the English), and
 * reads them through the email's locale, which the sender passes in: the app
 * formats them from its own catalogues, so an email speaks the language the
 * product does. Without a locale an email reads in English. Words people
 * wrote (titles, names, replies, notes) are passed in as values and never
 * translated.
 */
export interface EmailMessage {
  id: string
  defaultMessage: string
}

export type EmailValues = Record<string, string | number>

export interface EmailLocale {
  /** BCP-47 language of the copy, for `<html lang>`. */
  lang: string
  dir: 'ltr' | 'rtl'
  t(message: EmailMessage, values?: EmailValues): string
}

const registry = new Map<string, string>()

/** Name a template's messages; every one is listed in {@link emailMessages}. */
export function defineEmailMessages<T extends Record<string, EmailMessage>>(messages: T): T {
  for (const message of Object.values(messages)) registry.set(message.id, message.defaultMessage)
  return messages
}

/** Every email message the templates name, id to English, for the catalogue checks. */
export function emailMessages(): ReadonlyMap<string, string> {
  return registry
}

/**
 * Format an English message: `{name}` takes the value, and a plural argument
 * (`{count, plural, one {# item} other {# items}}`) picks its English form.
 */
export function formatEnglish(message: string, values: EmailValues = {}): string {
  let out = ''
  let i = 0
  while (i < message.length) {
    const open = message.indexOf('{', i)
    if (open === -1) {
      out += message.slice(i)
      break
    }
    out += message.slice(i, open)
    let depth = 0
    let close = open
    for (; close < message.length; close++) {
      if (message[close] === '{') depth++
      else if (message[close] === '}' && --depth === 0) break
    }
    out += formatArgument(message.slice(open + 1, close), values)
    i = close + 1
  }
  return out
}

function formatArgument(body: string, values: EmailValues): string {
  const [name, kind] = body.split(',').map((part) => part.trim())
  const value = values[name!]
  if (kind !== 'plural') return value === undefined ? `{${body}}` : String(value)
  const count = Number(value)
  const options = body.slice(body.indexOf(',', body.indexOf(',') + 1) + 1)
  const forms = new Map<string, string>()
  const pattern = /\s*(=\d+|\w+)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(options))) {
    let depth = 1
    let end = pattern.lastIndex
    for (; end < options.length && depth > 0; end++) {
      if (options[end] === '{') depth++
      else if (options[end] === '}') depth--
    }
    forms.set(match[1]!, options.slice(pattern.lastIndex, end - 1))
    pattern.lastIndex = end
  }
  const chosen =
    forms.get(`=${count}`) ??
    forms.get(new Intl.PluralRules('en').select(count)) ??
    forms.get('other') ??
    ''
  return formatEnglish(chosen.replace(/#/g, String(count)), values)
}

export const ENGLISH_EMAIL: EmailLocale = {
  lang: 'en',
  dir: 'ltr',
  t: (message, values) => formatEnglish(message.defaultMessage, values),
}
