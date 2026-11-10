/**
 * Written by scripts/font-fallbacks.ts; run it again after adding a bundled
 * family. For each family, how to size a font every visitor has so it takes
 * the family's room while the family's file loads: size-adjust, then the
 * ascent, descent and line gap overrides, as percentages.
 */
import type { BundledFontId } from './fonts'

export interface FallbackMetrics {
  /** Which system face stands in: Arial, Times New Roman or Courier New. */
  system: 'sans' | 'serif' | 'mono'
  size: number
  ascent: number
  descent: number
  lineGap: number
}

/** The system faces by name, and the same faces as Linux ships them. */
export const SYSTEM_FACES = {
  sans: ['Arial', 'Liberation Sans'],
  serif: ['Times New Roman', 'Liberation Serif'],
  mono: ['Courier New', 'Liberation Mono'],
} as const

/** Every bundled family but the system ones, which never swap. */
export const FONT_FALLBACKS: Partial<Record<BundledFontId, FallbackMetrics>> = {
  inter: { system: 'sans', size: 106.39, ascent: 91.06, descent: 22.67, lineGap: 0 },
  roboto: { system: 'sans', size: 99.03, ascent: 93.68, descent: 24.65, lineGap: 0 },
  'open-sans': { system: 'sans', size: 104.21, ascent: 102.56, descent: 28.11, lineGap: 0 },
  lato: { system: 'sans', size: 96.27, ascent: 102.52, descent: 22.12, lineGap: 0 },
  nunito: { system: 'sans', size: 100.9, ascent: 100.2, descent: 34.99, lineGap: 0 },
  poppins: { system: 'sans', size: 111.28, ascent: 94.36, descent: 31.45, lineGap: 8.99 },
  'dm-sans': { system: 'sans', size: 103.43, ascent: 95.91, descent: 29.97, lineGap: 0 },
  jakarta: { system: 'sans', size: 103.52, ascent: 100.27, descent: 21.44, lineGap: 0 },
  geist: { system: 'sans', size: 104.96, ascent: 87.65, descent: 20.96, lineGap: 9.53 },
  manrope: { system: 'sans', size: 101.62, ascent: 104.9, descent: 29.52, lineGap: 0 },
  'space-grotesk': { system: 'sans', size: 108.32, ascent: 90.84, descent: 26.96, lineGap: 0 },
  playfair: { system: 'serif', size: 110.68, ascent: 97.76, descent: 22.68, lineGap: 0 },
  merriweather: { system: 'serif', size: 118.2, ascent: 83.25, descent: 23.1, lineGap: 0 },
  lora: { system: 'serif', size: 114.59, ascent: 87.79, descent: 23.91, lineGap: 0 },
  'fira-code': { system: 'mono', size: 99.98, ascent: 99.02, descent: 32.21, lineGap: 0 },
  jetbrains: { system: 'mono', size: 99.98, ascent: 102.02, descent: 30, lineGap: 0 },
  'ibm-plex-sans': { system: 'sans', size: 100.01, ascent: 102.49, descent: 27.5, lineGap: 0 },
  fraunces: { system: 'serif', size: 114.63, ascent: 85.31, descent: 22.24, lineGap: 0 },
  'bricolage-grotesque': {
    system: 'sans',
    size: 104.28,
    ascent: 89.18,
    descent: 25.89,
    lineGap: 0,
  },
  'inter-tight': { system: 'sans', size: 95.91, ascent: 101.01, descent: 25.15, lineGap: 0 },
  sora: { system: 'sans', size: 111.83, ascent: 86.74, descent: 25.93, lineGap: 0 },
  outfit: { system: 'sans', size: 99.1, ascent: 100.91, descent: 26.24, lineGap: 0 },
  figtree: { system: 'sans', size: 99.75, ascent: 95.24, descent: 25.06, lineGap: 0 },
  'work-sans': { system: 'sans', size: 111.32, ascent: 83.55, descent: 21.83, lineGap: 0 },
  'instrument-sans': { system: 'sans', size: 101.42, ascent: 95.64, descent: 24.65, lineGap: 0 },
  'noto-sans': { system: 'sans', size: 105.27, ascent: 101.55, descent: 27.83, lineGap: 0 },
  rubik: { system: 'sans', size: 103.79, ascent: 90.09, descent: 24.09, lineGap: 0 },
  karla: { system: 'sans', size: 100.96, ascent: 90.83, descent: 24.96, lineGap: 0 },
  'libre-franklin': { system: 'sans', size: 102.98, ascent: 93.81, descent: 23.89, lineGap: 0 },
  'barlow-condensed': { system: 'sans', size: 75.76, ascent: 131.99, descent: 26.4, lineGap: 0 },
  oswald: { system: 'sans', size: 80.59, ascent: 148.04, descent: 35.86, lineGap: 0 },
  'source-serif': { system: 'serif', size: 117.25, ascent: 88.36, descent: 28.57, lineGap: 0 },
  archivo: { system: 'sans', size: 97.9, ascent: 89.68, descent: 21.45, lineGap: 0 },
  unbounded: { system: 'sans', size: 133.23, ascent: 74.68, descent: 18.39, lineGap: 0 },
  'roboto-slab': { system: 'serif', size: 116.43, ascent: 90, descent: 23.27, lineGap: 0 },
  'bodoni-moda': { system: 'serif', size: 113.52, ascent: 99.1, descent: 35.24, lineGap: 0 },
  quicksand: { system: 'sans', size: 103.84, ascent: 96.3, descent: 24.07, lineGap: 0 },
  'mona-sans': { system: 'sans', size: 103.18, ascent: 105.64, descent: 31.01, lineGap: 0 },
  'hanken-grotesk': { system: 'sans', size: 100.54, ascent: 99.47, descent: 30.14, lineGap: 0 },
}
