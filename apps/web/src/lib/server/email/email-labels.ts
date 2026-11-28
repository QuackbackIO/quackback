/**
 * Labels an email builds from raw facts, in the reader's language: a status
 * email's incident status, each affected service's status and the
 * maintenance window's times, and an SLA alert's due time. Each is read from
 * the raw value the target recorded; a target queued without one keeps the
 * English label it carried.
 */
import type { EmailLocale } from '@quackback/email'

/** snake_case status to the catalogue's camelCase key segment. */
function camel(status: string): string {
  return status.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function label(i18n: EmailLocale, prefix: string, raw: unknown, english: unknown): string {
  if (typeof raw !== 'string') return typeof english === 'string' ? english : ''
  const fallback = typeof english === 'string' ? english : raw
  return i18n.t({ id: `${prefix}.${camel(raw)}`, defaultMessage: fallback })
}

export function localizeStatusEmail(
  config: Record<string, unknown>,
  i18n: EmailLocale
): { statusLabel: string; affectedComponents: Array<{ name: string; status: string }> } {
  const components =
    (config.affectedComponents as Array<{ name: string; status: string; statusKey?: string }>) ?? []
  return {
    statusLabel: label(i18n, 'portal.status.lifecycle', config.incidentStatus, config.statusLabel),
    affectedComponents: components.map((c) => ({
      name: c.name,
      status: label(i18n, 'portal.status.componentStatus', c.statusKey, c.status),
    })),
  }
}

/** "12 July 2026, 02:00 UTC" in the reader's language, on the 24-hour clock. */
export function formatStatusDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === 'en' ? 'en-US' : lang, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

export function maintenanceWindow(
  config: Record<string, unknown>,
  i18n: EmailLocale
): { startLabel: string; endLabel: string } {
  const at = (iso: unknown, english: unknown) =>
    typeof iso === 'string' ? formatStatusDate(iso, i18n.lang) : ((english as string) ?? '')
  return {
    startLabel: at(config.scheduledStartAt, config.scheduledStartLabel),
    endLabel: at(config.scheduledEndAt, config.scheduledEndLabel),
  }
}

/** An SLA due time ("Jul 12, 02:00 UTC") in the reader's language. */
export function formatSlaDueFor(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === 'en' ? 'en-US' : lang, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}
