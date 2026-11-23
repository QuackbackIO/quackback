/**
 * The static path alone (HTML and stylesheets, nothing run) on small
 * pages modelled on the measured sites: each page's markup and CSS is written
 * the way such sites write theirs (custom properties, utility classes, dark
 * and small-screen rules, consent banners), and must give the page colour,
 * text colour and shape the browser measured (spec section 9).
 */
import { describe, expect, it } from 'vitest'
import { mapBrandRead, type BrandDraft } from '@/lib/shared/theme/brand-import'
import { brandReadFromSite } from '../static-reader'
import { parseSiteFacts } from '../site/site-facts'

interface Modelled {
  html: string
  css: string
  expected: Pick<
    BrandDraft,
    'background' | 'scheme' | 'text' | 'radius' | 'buttonShape' | 'buttonPx'
  >
}

const doc = (body: string, bodyClass = '') =>
  `<!doctype html><html lang="en"><head><title>Home</title></head><body class="${bodyClass}">${body}</body></html>`

const consent = `<div id="onetrust-consent-sdk"><div class="ot-sdk-row"><button class="ot-btn-primary" style="">Accept all</button></div></div>`

const SITES: Record<string, Modelled> = {
  // Transparent page, black text, 4px corners on a 40px button.
  'stripe.com': {
    html: doc(
      `${consent}<header><a class="hds-button hds-button--primary" href="/contact">Contact sales</a></header>`
    ),
    css: `:root{--hds-color-action:#533afd;--hds-radius-sm:4px}
      body{color:#000000;font-family:sohne-var,"SF Pro Display",sans-serif}
      .hds-button{border-radius:var(--hds-radius-sm);height:40px}
      .hds-button--primary{background-color:var(--hds-color-action)}
      .ot-btn-primary{border-radius:20px}
      @media (prefers-color-scheme:dark){body{background:#0a2540;color:#ffffff}}`,
    expected: {
      background: '#ffffff',
      scheme: 'light',
      text: undefined,
      radius: 0.25,
      buttonShape: 'corners',
      buttonPx: 4,
    },
  },
  // Warm page through custom properties, a round icon button.
  'www.ikea.com': {
    html: doc(
      `${consent}<a class="btn btn--icon-primary-inverse" href="/rooms">Rooms</a>`,
      'theme-default'
    ),
    css: `:root{--colour-neutral-1:#fffefb;--colour-text-and-icon-1:#111111}
      .theme-default{background:var(--colour-neutral-1);color:var(--colour-text-and-icon-1)}
      .btn{border-radius:64px}
      .btn--icon-primary-inverse{border-radius:50%;background-color:#111111}
      @media (max-width:600px){.theme-default{background:#ffffff}}`,
    expected: {
      background: '#fffefb',
      scheme: 'light',
      text: undefined,
      radius: 0.5,
      buttonShape: 'pill',
    },
  },
  // Dark page, light text, a pill.
  'linear.app': {
    html: doc(
      `<header><a class="Button_root__a1b2 Button_variant-primary__c3d4" href="/signup">Sign up</a></header>`
    ),
    css: `:root{--color-bg-primary:#08090a;--color-text-primary:#f7f8f8;--radius-rounded:9999px}
      html{background:#ffffff}
      body{background:var(--color-bg-primary);color:var(--color-text-primary)}
      .Button_root__a1b2{border-radius:var(--radius-rounded);height:32px}
      .Button_variant-primary__c3d4{background:#e5e5e6}`,
    expected: {
      background: '#08090a',
      scheme: 'dark',
      text: undefined,
      radius: 0.5,
      buttonShape: 'pill',
    },
  },
  // White page, near-black translucent text, 8px corners.
  'notion.com': {
    html: doc(`<a class="ctaButton ctaButton--primary" href="/signup">Get it free</a>`),
    css: `body{background:#fff;color:rgba(0,0,0,.95)}
      .ctaButton{border-radius:8px;height:36px}
      .ctaButton--primary{background:#0075de}`,
    expected: {
      background: '#ffffff',
      scheme: 'light',
      text: undefined,
      radius: 0.5,
      buttonShape: 'corners',
      buttonPx: 8,
    },
  },
}

function staticDraft(site: string, { html, css }: Modelled): BrandDraft {
  const url = `https://${site}/`
  const facts = parseSiteFacts(html, url, [{ url: `${url}main.css`, css }])
  return mapBrandRead(
    brandReadFromSite({
      facts,
      favicon: null,
      icon: null,
      logo: null,
      shareImage: null,
      failed: null,
    })
  )
}

describe('the static path on pages modelled on the measured sites', () => {
  it.each(Object.keys(SITES))(
    '%s gives the measured page colour, text colour and shape',
    (site) => {
      const draft = staticDraft(site, SITES[site])
      expect({
        background: draft.background,
        scheme: draft.scheme,
        text: draft.text,
        radius: draft.radius,
        buttonShape: draft.buttonShape,
        buttonPx: draft.buttonPx,
      }).toEqual(SITES[site].expected)
      expect(draft.missing).not.toContain('page')
      expect(draft.missing).not.toContain('shape')
    }
  )
})
