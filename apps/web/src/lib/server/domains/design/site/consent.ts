/**
 * The design domain's one consent rule: how a site's cookie, consent or
 * privacy UI is told apart from the brand, so no reading of the site (its
 * stylesheets' colours, the capture's clean-up, the screenshot read) takes a
 * consent banner for the brand.
 *
 * The same wording the brand rig's capture tools use; keep the two in step.
 */

/**
 * Words only a cookie or consent banner shows, in the languages the capture
 * browses in.
 */
export const CONSENT_WORDS =
  /cookie|consent|privacy|gdpr|tracking|datenschutz|akzeptieren|confidentialit|accepter|aceptar|rechazar|privacidad/i

/**
 * An id, class or attribute naming a consent container: cookie, consent or
 * GDPR UI, a consent platform's own markup, or a privacy or tracking banner.
 * Tracking and privacy alone are not enough (`tracking-tight` is a type
 * utility, `privacy-first` a brand claim).
 */
export const CONSENT_MARKUP =
  /cookie|consent|gdpr|onetrust|optanon|ot-sdk|cookiebot|cybot|didomi|usercentrics|truste|trustarc|osano|termly|iubenda|klaro|ketch-|qc-cmp|\bcmp\b|\bcky-|\bcc-(?:window|banner|btn|revoke)|privacy[-_ ]?(?:banner|notice|prompt|manager|cent(?:er|re)|settings|preferences|choices|modal|popup|bar|overlay)|tracking[-_ ]?(?:banner|consent|notice|prompt|preferences)/i

/** A CSS selector that styles consent UI. */
export function isConsentSelector(selector: string): boolean {
  return CONSENT_MARKUP.test(selector)
}

/** A stylesheet served for consent UI, by its host or path (never its query). */
export function isConsentStylesheet(url: string): boolean {
  try {
    const parsed = new URL(url)
    return CONSENT_MARKUP.test(`${parsed.hostname}${parsed.pathname}`)
  } catch {
    return false
  }
}
