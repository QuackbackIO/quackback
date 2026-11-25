/**
 * Accessible names the SDK puts on the host page, in the visitor's language.
 * Covers the languages the widget itself ships; anything else reads English.
 */

/** The entry for a locale tag: the exact tag, then its language. */
export function forLocale<T>(table: Record<string, T>, locale: string | undefined): T | undefined {
  const tag = (locale ?? '').toLowerCase()
  return table[tag] ?? table[tag.split('-')[0]!]
}

/** The panel's (and its frame's) accessible name. */
const PANEL_TITLE: Record<string, string> = {
  ar: 'مساعدة',
  de: 'Hilfe',
  es: 'Ayuda',
  fr: 'Aide',
  nl: 'Hulp',
  pl: 'Pomoc',
  pt: 'Ajuda',
  ru: 'Помощь',
  th: 'ความช่วยเหลือ',
  uk: 'Допомога',
  zh: '帮助',
  'zh-tw': '說明',
}

export function panelTitle(locale: string | undefined): string {
  return forLocale(PANEL_TITLE, locale) ?? 'Help'
}

export interface LauncherLabels {
  open: string
  close: string
  /** The closed button's name with the unread count the badge shows. */
  unread: (name: string, count: number) => string
}

const LAUNCHER_LABELS: Record<string, LauncherLabels> = {
  en: { open: 'Open help', close: 'Close help', unread: (n, c) => `${n}, ${c} unread` },
  ar: {
    open: 'فتح المساعدة',
    close: 'إغلاق المساعدة',
    unread: (n, c) => `${n}، ${c} غير مقروءة`,
  },
  de: { open: 'Hilfe öffnen', close: 'Hilfe schließen', unread: (n, c) => `${n}, ${c} ungelesen` },
  es: { open: 'Abrir ayuda', close: 'Cerrar ayuda', unread: (n, c) => `${n}, ${c} sin leer` },
  fr: { open: "Ouvrir l'aide", close: "Fermer l'aide", unread: (n, c) => `${n}, ${c} non lus` },
  nl: { open: 'Help openen', close: 'Help sluiten', unread: (n, c) => `${n}, ${c} ongelezen` },
  pl: {
    open: 'Otwórz pomoc',
    close: 'Zamknij pomoc',
    unread: (n, c) => `${n}, nieprzeczytane: ${c}`,
  },
  pt: { open: 'Abrir ajuda', close: 'Fechar ajuda', unread: (n, c) => `${n}, ${c} não lidas` },
  ru: {
    open: 'Открыть помощь',
    close: 'Закрыть помощь',
    unread: (n, c) => `${n}, непрочитанных: ${c}`,
  },
  th: {
    open: 'เปิดความช่วยเหลือ',
    close: 'ปิดความช่วยเหลือ',
    unread: (n, c) => `${n}, ยังไม่ได้อ่าน ${c} รายการ`,
  },
  uk: {
    open: 'Відкрити допомогу',
    close: 'Закрити допомогу',
    unread: (n, c) => `${n}, непрочитаних: ${c}`,
  },
  zh: { open: '打开帮助', close: '关闭帮助', unread: (n, c) => `${n}，${c} 条未读` },
  'zh-tw': { open: '開啟說明', close: '關閉說明', unread: (n, c) => `${n}，${c} 則未讀` },
}

export function launcherLabels(locale: string | undefined): LauncherLabels {
  return forLocale(LAUNCHER_LABELS, locale) ?? LAUNCHER_LABELS.en!
}
