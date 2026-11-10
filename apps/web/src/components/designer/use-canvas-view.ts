import { useState } from 'react'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { SupportedLocale } from '@/lib/shared/i18n'
import type { CanvasSize, CanvasZoom } from './designer-canvas'

/** How the canvas shows the page while editing, which changes nothing in the design. */
export interface CanvasView {
  size: CanvasSize
  setSize: (size: CanvasSize) => void
  /** Light or dark, for a design that lets visitors choose. */
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
  locale: SupportedLocale
  setLocale: (locale: SupportedLocale) => void
  zoom: CanvasZoom
  setZoom: (zoom: CanvasZoom) => void
}

/** The canvas's device, light or dark, language and zoom, from desktop, English and Fit. */
export function useCanvasView(mode: PortalDesign['mode']): CanvasView {
  const [size, setSize] = useState<CanvasSize>('desktop')
  const [theme, setTheme] = useState<'light' | 'dark'>(mode === 'dark' ? 'dark' : 'light')
  const [locale, setLocale] = useState<SupportedLocale>('en')
  const [zoom, setZoom] = useState<CanvasZoom>('fit')
  return { size, setSize, theme, setTheme, locale, setLocale, zoom, setZoom }
}
