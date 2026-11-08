/**
 * What a portal page tells the browser and a link preview about itself: the
 * site's name as the header shows it, each page's name and description in
 * the workspace's main language, the favicon, and the share card.
 *
 * Head text is read by crawlers and link previews, not by one visitor, so it
 * is written in the workspace's main language (the portal localisation rule:
 * the owner's words fall back to the main language), never the visitor's.
 */
import { normalizeLocale, DEFAULT_LOCALE, type SupportedLocale } from './i18n'
import type { PortalDesignView } from './design/view'
import { shareCardPath, type ShareCardPage } from './design/share-card'

/** The settings a portal head reads. */
export interface PortalHeadSettings {
  name?: string | null
  portalDesign?: PortalDesignView
  helpCenterConfig?: { locales?: { default?: string } } | null
  brandingData?: { logoUrl?: string | null } | null
  faviconData?: { url: string } | null
}

/** The site's name as the header shows it: the Brand kit's title, else the workspace's name. */
export function portalSiteName(settings: PortalHeadSettings | null | undefined): string {
  const design = settings?.portalDesign
  const title = design?.engine === 'v2' ? design.logo.name?.trim() : undefined
  return title || settings?.name || 'Quackback'
}

/**
 * The workspace's main language. Until it has a setting of its own, the
 * help center's default language is the one place a workspace states it.
 */
export function portalMainLanguage(
  settings: PortalHeadSettings | null | undefined
): SupportedLocale {
  const stated = settings?.helpCenterConfig?.locales?.default
  return (stated && normalizeLocale(stated)) || DEFAULT_LOCALE
}

type Page = 'feedback' | 'roadmap' | 'changelog' | 'status' | 'help'
type Words = {
  pages: Record<Page, string>
  /** The portal's own description, and Feedback's. */
  portal: (name: string) => string
  feedback: (name: string) => string
  roadmap: (name: string) => string
  changelog: (name: string) => string
  entry: (title: string, name: string) => string
  status: (name: string) => string
  incident: (title: string, name: string) => string
  post: (title: string, board: string) => string
}

const WORDS: Record<SupportedLocale, Words> = {
  en: {
    pages: {
      feedback: 'Feedback',
      roadmap: 'Roadmap',
      changelog: 'Changelog',
      status: 'Status',
      help: 'Help Center',
    },
    portal: (n) => `Share feedback, vote on posts and follow the ${n} roadmap.`,
    feedback: (n) => `Share feedback and vote on posts for ${n}.`,
    roadmap: (n) => `See what ${n} is working on and what comes next.`,
    changelog: (n) => `The latest updates from ${n}.`,
    entry: (t, n) => `${t}. An update from ${n}.`,
    status: (n) => `Live status and incident history for ${n}.`,
    incident: (t, n) => `${t}. A status update from ${n}.`,
    post: (t, b) => `${t}. Vote and comment on this post in ${b}.`,
  },
  de: {
    pages: {
      feedback: 'Feedback',
      roadmap: 'Roadmap',
      changelog: 'Neuigkeiten',
      status: 'Status',
      help: 'Hilfe-Center',
    },
    portal: (n) => `Teile Feedback, stimme über Beiträge ab und verfolge die Roadmap von ${n}.`,
    feedback: (n) => `Teile Feedback und stimme über Beiträge für ${n} ab.`,
    roadmap: (n) => `Sieh, woran ${n} gerade arbeitet und was als Nächstes kommt.`,
    changelog: (n) => `Die neuesten Updates von ${n}.`,
    entry: (t, n) => `${t}. Ein Update von ${n}.`,
    status: (n) => `Aktueller Status und Störungsverlauf von ${n}.`,
    incident: (t, n) => `${t}. Eine Statusmeldung von ${n}.`,
    post: (t, b) => `${t}. Stimme ab und kommentiere diesen Beitrag in ${b}.`,
  },
  fr: {
    pages: {
      feedback: 'Feedback',
      roadmap: 'Feuille de route',
      changelog: 'Nouveautés',
      status: 'Statut',
      help: "Centre d'aide",
    },
    portal: (n) =>
      `Partagez vos retours, votez pour des publications et suivez la feuille de route de ${n}.`,
    feedback: (n) => `Partagez vos retours et votez pour des publications de ${n}.`,
    roadmap: (n) => `Découvrez ce sur quoi ${n} travaille et ce qui arrive ensuite.`,
    changelog: (n) => `Les dernières nouveautés de ${n}.`,
    entry: (t, n) => `${t}. Une nouveauté de ${n}.`,
    status: (n) => `Statut en direct et historique des incidents de ${n}.`,
    incident: (t, n) => `${t}. Une mise à jour du statut de ${n}.`,
    post: (t, b) => `${t}. Votez et commentez cette publication dans ${b}.`,
  },
  es: {
    pages: {
      feedback: 'Feedback',
      roadmap: 'Roadmap',
      changelog: 'Novedades',
      status: 'Estado',
      help: 'Centro de ayuda',
    },
    portal: (n) => `Comparte tus comentarios, vota publicaciones y sigue el roadmap de ${n}.`,
    feedback: (n) => `Comparte tus comentarios y vota publicaciones de ${n}.`,
    roadmap: (n) => `Mira en qué está trabajando ${n} y qué viene después.`,
    changelog: (n) => `Las últimas novedades de ${n}.`,
    entry: (t, n) => `${t}. Una novedad de ${n}.`,
    status: (n) => `Estado en vivo e historial de incidentes de ${n}.`,
    incident: (t, n) => `${t}. Una actualización de estado de ${n}.`,
    post: (t, b) => `${t}. Vota y comenta esta publicación en ${b}.`,
  },
  ar: {
    pages: {
      feedback: 'الملاحظات',
      roadmap: 'خارطة الطريق',
      changelog: 'آخر المستجدات',
      status: 'الحالة',
      help: 'مركز المساعدة',
    },
    portal: (n) => `شارك ملاحظاتك وصوّت على المنشورات وتابع خارطة طريق ${n}.`,
    feedback: (n) => `شارك ملاحظاتك وصوّت على منشورات ${n}.`,
    roadmap: (n) => `اطّلع على ما يعمل عليه ${n} وما هو قادم.`,
    changelog: (n) => `آخر المستجدات من ${n}.`,
    entry: (t, n) => `${t}. تحديث من ${n}.`,
    status: (n) => `الحالة المباشرة وسجل الحوادث لـ ${n}.`,
    incident: (t, n) => `${t}. تحديث للحالة من ${n}.`,
    post: (t, b) => `${t}. صوّت وعلّق على هذا المنشور في ${b}.`,
  },
  ru: {
    pages: {
      feedback: 'Обратная связь',
      roadmap: 'Дорожная карта',
      changelog: 'Журнал изменений',
      status: 'Статус',
      help: 'Помощь',
    },
    portal: (n) => `Делитесь отзывами, голосуйте за публикации и следите за дорожной картой ${n}.`,
    feedback: (n) => `Делитесь отзывами и голосуйте за публикации ${n}.`,
    roadmap: (n) => `Узнайте, над чем работает ${n} и что будет дальше.`,
    changelog: (n) => `Последние обновления ${n}.`,
    entry: (t, n) => `${t}. Обновление от ${n}.`,
    status: (n) => `Текущий статус и история инцидентов ${n}.`,
    incident: (t, n) => `${t}. Обновление статуса от ${n}.`,
    post: (t, b) => `${t}. Голосуйте и комментируйте эту публикацию в ${b}.`,
  },
  'pt-br': {
    pages: {
      feedback: 'Feedback',
      roadmap: 'Roadmap',
      changelog: 'Changelog',
      status: 'Status',
      help: 'Central de Ajuda',
    },
    portal: (n) => `Compartilhe feedback, vote em publicações e acompanhe o roadmap de ${n}.`,
    feedback: (n) => `Compartilhe feedback e vote em publicações de ${n}.`,
    roadmap: (n) => `Veja no que ${n} está trabalhando e o que vem a seguir.`,
    changelog: (n) => `As últimas novidades de ${n}.`,
    entry: (t, n) => `${t}. Uma novidade de ${n}.`,
    status: (n) => `Status ao vivo e histórico de incidentes de ${n}.`,
    incident: (t, n) => `${t}. Uma atualização de status de ${n}.`,
    post: (t, b) => `${t}. Vote e comente esta publicação em ${b}.`,
  },
  'zh-cn': {
    pages: {
      feedback: '反馈',
      roadmap: '路线图',
      changelog: '更新日志',
      status: '状态',
      help: '帮助中心',
    },
    portal: (n) => `分享反馈、为帖子投票，并关注 ${n} 的路线图。`,
    feedback: (n) => `为 ${n} 分享反馈并为帖子投票。`,
    roadmap: (n) => `了解 ${n} 正在做什么以及接下来的计划。`,
    changelog: (n) => `${n} 的最新更新。`,
    entry: (t, n) => `${t}。来自 ${n} 的更新。`,
    status: (n) => `${n} 的实时状态和事件历史。`,
    incident: (t, n) => `${t}。来自 ${n} 的状态更新。`,
    post: (t, b) => `${t}。在 ${b} 中为这个帖子投票和评论。`,
  },
  'zh-tw': {
    pages: {
      feedback: '意見回饋',
      roadmap: '產品藍圖',
      changelog: '更新日誌',
      status: '狀態',
      help: '說明中心',
    },
    portal: (n) => `分享意見、為貼文投票，並關注 ${n} 的產品藍圖。`,
    feedback: (n) => `為 ${n} 分享意見並為貼文投票。`,
    roadmap: (n) => `看看 ${n} 正在做什麼，以及接下來的計畫。`,
    changelog: (n) => `${n} 的最新更新。`,
    entry: (t, n) => `${t}。來自 ${n} 的更新。`,
    status: (n) => `${n} 的即時狀態與事件紀錄。`,
    incident: (t, n) => `${t}。來自 ${n} 的狀態更新。`,
    post: (t, b) => `${t}。在 ${b} 中為這篇貼文投票和留言。`,
  },
  nl: {
    pages: {
      feedback: 'Feedback',
      roadmap: 'Roadmap',
      changelog: 'Changelog',
      status: 'Status',
      help: 'Helpcentrum',
    },
    portal: (n) => `Deel feedback, stem op berichten en volg de roadmap van ${n}.`,
    feedback: (n) => `Deel feedback en stem op berichten voor ${n}.`,
    roadmap: (n) => `Zie waar ${n} aan werkt en wat er hierna komt.`,
    changelog: (n) => `De nieuwste updates van ${n}.`,
    entry: (t, n) => `${t}. Een update van ${n}.`,
    status: (n) => `Live status en incidentgeschiedenis van ${n}.`,
    incident: (t, n) => `${t}. Een statusupdate van ${n}.`,
    post: (t, b) => `${t}. Stem en reageer op dit bericht in ${b}.`,
  },
  pl: {
    pages: {
      feedback: 'Opinie',
      roadmap: 'Plan rozwoju',
      changelog: 'Lista zmian',
      status: 'Status',
      help: 'Centrum pomocy',
    },
    portal: (n) => `Dziel się opiniami, głosuj na wpisy i śledź plan rozwoju ${n}.`,
    feedback: (n) => `Dziel się opiniami i głosuj na wpisy dla ${n}.`,
    roadmap: (n) => `Zobacz, nad czym pracuje ${n} i co będzie dalej.`,
    changelog: (n) => `Najnowsze zmiany w ${n}.`,
    entry: (t, n) => `${t}. Aktualizacja od ${n}.`,
    status: (n) => `Bieżący status i historia incydentów ${n}.`,
    incident: (t, n) => `${t}. Aktualizacja statusu od ${n}.`,
    post: (t, b) => `${t}. Głosuj i komentuj ten wpis w ${b}.`,
  },
  th: {
    pages: {
      feedback: 'ความคิดเห็น',
      roadmap: 'แผนพัฒนา',
      changelog: 'บันทึกการเปลี่ยนแปลง',
      status: 'สถานะ',
      help: 'ศูนย์ช่วยเหลือ',
    },
    portal: (n) => `แชร์ความคิดเห็น โหวตโพสต์ และติดตามแผนพัฒนาของ ${n}`,
    feedback: (n) => `แชร์ความคิดเห็นและโหวตโพสต์ของ ${n}`,
    roadmap: (n) => `ดูว่า ${n} กำลังทำอะไรอยู่และจะมีอะไรต่อไป`,
    changelog: (n) => `อัปเดตล่าสุดจาก ${n}`,
    entry: (t, n) => `${t} อัปเดตจาก ${n}`,
    status: (n) => `สถานะปัจจุบันและประวัติเหตุขัดข้องของ ${n}`,
    incident: (t, n) => `${t} อัปเดตสถานะจาก ${n}`,
    post: (t, b) => `${t} โหวตและแสดงความคิดเห็นในโพสต์นี้ใน ${b}`,
  },
  uk: {
    pages: {
      feedback: 'Відгуки',
      roadmap: 'Дорожня карта',
      changelog: 'Журнал змін',
      status: 'Статус',
      help: 'Центр довідки',
    },
    portal: (n) => `Діліться відгуками, голосуйте за дописи та стежте за дорожньою картою ${n}.`,
    feedback: (n) => `Діліться відгуками та голосуйте за дописи ${n}.`,
    roadmap: (n) => `Дізнайтеся, над чим працює ${n} і що буде далі.`,
    changelog: (n) => `Останні оновлення ${n}.`,
    entry: (t, n) => `${t}. Оновлення від ${n}.`,
    status: (n) => `Поточний статус та історія інцидентів ${n}.`,
    incident: (t, n) => `${t}. Оновлення статусу від ${n}.`,
    post: (t, b) => `${t}. Голосуйте та коментуйте цей допис у ${b}.`,
  },
}

/** The head's words in the workspace's main language. */
export function portalHeadWords(settings: PortalHeadSettings | null | undefined): Words {
  return WORDS[portalMainLanguage(settings)]
}

/** A page's title: its name, then the site's. */
export const pageTitle = (settings: PortalHeadSettings | null | undefined, page: Page) =>
  `${portalHeadWords(settings).pages[page]} - ${portalSiteName(settings)}`

/**
 * The favicon: the design's own, then the brand icon, then the workspace's
 * favicon and logo, then the default.
 */
export function portalFavicon(settings: PortalHeadSettings | null | undefined): string {
  const design = settings?.portalDesign
  const icons = design?.engine === 'v2' ? design.icons : undefined
  return (
    icons?.favicon ||
    icons?.mark ||
    settings?.faviconData?.url ||
    settings?.brandingData?.logoUrl ||
    '/logo.png'
  )
}

const absolute = (path: string, baseUrl: string | null | undefined) => {
  if (!baseUrl) return path
  try {
    return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
  } catch {
    return path
  }
}

/**
 * The image a shared link shows, absolute: the design's own share image,
 * else its drawn card (with the page's name), else null for a portal on the
 * legacy theme, which keeps its own.
 */
export function portalShareImage(
  settings: PortalHeadSettings | null | undefined,
  baseUrl: string | null | undefined,
  page?: ShareCardPage
): string | null {
  const design = settings?.portalDesign
  if (design?.engine !== 'v2' || !design.icons) return null
  if (design.icons.shareImage) return absolute(design.icons.shareImage, baseUrl)
  if (!design.icons.card) return null
  return absolute(shareCardPath(design.icons.card, portalSiteName(settings), page), baseUrl)
}

/** The meta that points a link preview at a page's own card, to sit over the portal's. */
export function pageShareMeta(
  settings: PortalHeadSettings | null | undefined,
  baseUrl: string | null | undefined,
  page: ShareCardPage
): Array<Record<string, string>> {
  const design = settings?.portalDesign
  // The design's own share image is the same on every page; the portal's head has it.
  if (design?.engine !== 'v2' || design.icons?.shareImage) return []
  const image = portalShareImage(settings, baseUrl, page)
  return image ? [{ property: 'og:image', content: image }] : []
}

/** The workspace settings a route's head reads, from the root match's context. */
export function headSettings(
  matches: ReadonlyArray<{ context?: unknown }> | undefined
): PortalHeadSettings | null {
  return (
    (matches?.[0]?.context as { settings?: PortalHeadSettings | null } | undefined)?.settings ??
    null
  )
}

/**
 * The browser chrome's colour (theme-color): the page colour, one per mode
 * the visitor may see, told apart by media query; one alone when the mode is fixed.
 */
export function portalThemeColors(
  design: PortalDesignView | undefined,
  forced: 'light' | 'dark' | undefined
): Array<{ content: string; media?: string }> {
  const colours = design?.engine === 'v2' ? design.icons?.themeColor : undefined
  if (!colours) return []
  if (forced) {
    const content = colours[forced]
    return content ? [{ content }] : []
  }
  return (['light', 'dark'] as const).flatMap((mode) => {
    const content = colours[mode]
    return content ? [{ content, media: `(prefers-color-scheme: ${mode})` }] : []
  })
}
