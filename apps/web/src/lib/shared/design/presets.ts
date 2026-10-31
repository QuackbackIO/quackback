/**
 * Presets: starting looks for a portal design. Each sets the mode, colours,
 * fonts, corners and layout, and differs from the others in more than hue.
 * Applying one changes the draft's look and leaves its pages, menu, words and
 * logo alone.
 */
import type { BundledFontId } from './fonts'
import type { PortalDesign } from './schema'

type Brand = PortalDesign['brand']

export interface DesignPreset {
  id: string
  label: string
  /** One line on what the look is for. */
  description: string
  look: {
    mode: PortalDesign['mode']
    brand: { light: Brand['light']; dark?: Brand['dark']; fonts: Brand['fonts'] }
    shape: PortalDesign['shape']
    layout: PortalDesign['layout']
  }
}

const bundled = (id: BundledFontId) => ({ kind: 'bundled' as const, id })

export const DESIGN_PRESETS: readonly DesignPreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Today’s portal: clear tabs, bordered cards.',
    look: {
      mode: 'auto',
      brand: {
        light: { accent: 'oklch(0.886 0.176 86)', background: '#ffffff', ink: '#0a0a0a' },
        fonts: { heading: bundled('inter'), body: bundled('inter'), headingWeight: 600 },
      },
      shape: { corners: 'rounded' },
      layout: {
        header: 'stacked',
        nav: 'tabs',
        band: 'none',
        cards: 'bordered',
        density: 'comfortable',
        width: 'default',
        filters: 'end',
      },
    },
  },
  {
    id: 'studio',
    label: 'Studio',
    description: 'A bold band, pill menu and raised cards.',
    look: {
      mode: 'auto',
      brand: {
        light: { accent: '#7c3aed', background: '#ffffff', ink: '#18181b' },
        fonts: {
          heading: bundled('bricolage-grotesque'),
          body: bundled('inter'),
          headingWeight: 700,
        },
      },
      shape: { corners: 'pill' },
      layout: {
        header: 'stacked',
        nav: 'pills',
        band: 'brand',
        cards: 'raised',
        density: 'comfortable',
        width: 'default',
        filters: 'end',
      },
    },
  },
  {
    id: 'editorial',
    label: 'Editorial',
    description: 'Serif headings, a narrow column and list rows.',
    look: {
      mode: 'light',
      brand: {
        light: { accent: '#b91c1c', background: '#fffdf8', ink: '#1c1917', surface: '#ffffff' },
        fonts: { heading: bundled('fraunces'), body: bundled('inter'), headingWeight: 600 },
      },
      shape: { corners: 'sharp' },
      layout: {
        header: 'stacked',
        nav: 'underline',
        band: 'none',
        cards: 'list',
        density: 'spacious',
        width: 'narrow',
        filters: 'end',
      },
    },
  },
  {
    id: 'calm',
    label: 'Calm',
    description: 'Soft colours, room to breathe.',
    look: {
      mode: 'auto',
      brand: {
        light: { accent: '#0f766e', background: '#f8fafc', ink: '#0f172a', surface: '#ffffff' },
        fonts: { heading: bundled('nunito'), body: bundled('nunito'), headingWeight: 700 },
      },
      shape: { corners: 'rounded' },
      layout: {
        header: 'stacked',
        nav: 'tabs',
        band: 'tint',
        cards: 'raised',
        density: 'spacious',
        width: 'default',
        filters: 'end',
      },
    },
  },
  {
    id: 'technical',
    label: 'Technical',
    description: 'Dense rows and a wide page for long lists.',
    look: {
      mode: 'auto',
      brand: {
        light: { accent: '#2563eb', background: '#ffffff', ink: '#111827' },
        fonts: {
          heading: bundled('ibm-plex-sans'),
          body: bundled('ibm-plex-sans'),
          headingWeight: 600,
        },
      },
      shape: { corners: 'subtle' },
      layout: {
        header: 'stacked',
        nav: 'underline',
        band: 'none',
        cards: 'list',
        density: 'compact',
        width: 'wide',
        filters: 'start',
      },
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Dark by default, with a soft glow at the top.',
    look: {
      mode: 'dark',
      brand: {
        light: { accent: '#7c3aed', background: '#ffffff', ink: '#0b1020' },
        dark: { background: '#0b1020', ink: '#e5e7eb', surface: '#111833' },
        fonts: { heading: bundled('geist'), body: bundled('geist'), headingWeight: 600 },
      },
      shape: { corners: 'rounded' },
      layout: {
        header: 'stacked',
        nav: 'pills',
        band: 'fade',
        cards: 'raised',
        density: 'comfortable',
        width: 'default',
        filters: 'end',
      },
    },
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Warm paper, serif headings, a quiet tint.',
    look: {
      mode: 'light',
      brand: {
        light: { accent: '#92400e', background: '#faf7f2', ink: '#292524', surface: '#fffdf9' },
        fonts: { heading: bundled('lora'), body: bundled('inter'), headingWeight: 600 },
      },
      shape: { corners: 'subtle' },
      layout: {
        header: 'stacked',
        nav: 'tabs',
        band: 'tint',
        cards: 'bordered',
        density: 'comfortable',
        width: 'narrow',
        filters: 'end',
      },
    },
  },
  {
    id: 'bold',
    label: 'Bold',
    description: 'Big type, a full-colour band and pill shapes.',
    look: {
      mode: 'auto',
      brand: {
        light: { accent: '#e11d48', background: '#ffffff', ink: '#0a0a0a' },
        fonts: { heading: bundled('poppins'), body: bundled('poppins'), headingWeight: 700 },
      },
      shape: { corners: 'pill' },
      layout: {
        header: 'stacked',
        nav: 'pills',
        band: 'brand',
        cards: 'raised',
        density: 'comfortable',
        width: 'wide',
        filters: 'end',
      },
    },
  },
]

/** The draft with a preset's look; its pages, menu, words and logo stay as they were. */
export function applyPreset(doc: PortalDesign, preset: DesignPreset): PortalDesign {
  const next = structuredClone(doc)
  const { mode, brand, shape, layout } = structuredClone(preset.look)
  next.mode = mode
  next.brand.light = brand.light
  next.brand.fonts = brand.fonts
  if (brand.dark) next.brand.dark = brand.dark
  else delete next.brand.dark
  next.shape = shape
  next.layout = layout
  return next
}
