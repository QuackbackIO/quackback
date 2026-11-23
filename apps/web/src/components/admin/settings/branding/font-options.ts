import { DEFAULT_FONT_SANS } from '@/lib/shared/theme'

/** The listed fonts the Font select offers, each with its stack and group. */
// Each `value` family must be self-hosted in globals.css (matching the @fontsource
// @font-face family name), or the selection falls back to the generic stack.
export const FONT_OPTIONS = [
  {
    id: 'inter',
    name: 'Inter',
    value: DEFAULT_FONT_SANS,
    category: 'Sans Serif',
  },
  {
    id: 'system',
    name: 'System UI',
    value: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    category: 'System',
  },
  {
    id: 'roboto',
    name: 'Roboto',
    value: '"Roboto", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'open-sans',
    name: 'Open Sans',
    value: '"Open Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'lato',
    name: 'Lato',
    value: '"Lato", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'poppins',
    name: 'Poppins',
    value: '"Poppins", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'dm-sans',
    name: 'DM Sans',
    value: '"DM Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'jakarta',
    name: 'Plus Jakarta Sans',
    value: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'geist',
    name: 'Geist',
    // @fontsource publishes Geist as the "Geist Sans" family (see globals.css).
    value: '"Geist Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'manrope',
    name: 'Manrope',
    value: '"Manrope", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'space-grotesk',
    name: 'Space Grotesk',
    value: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'playfair',
    name: 'Playfair Display',
    value: '"Playfair Display", ui-serif, Georgia, serif',
    category: 'Serif',
  },
  {
    id: 'merriweather',
    name: 'Merriweather',
    value: '"Merriweather", ui-serif, Georgia, serif',
    category: 'Serif',
  },
  {
    id: 'lora',
    name: 'Lora',
    value: '"Lora", ui-serif, Georgia, serif',
    category: 'Serif',
  },
  {
    id: 'fira-code',
    name: 'Fira Code',
    value: '"Fira Code", ui-monospace, monospace',
    category: 'Monospace',
  },
  {
    id: 'jetbrains',
    name: 'JetBrains Mono',
    value: '"JetBrains Mono", ui-monospace, monospace',
    category: 'Monospace',
  },
] as const
