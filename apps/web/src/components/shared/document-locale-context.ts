import { createContext } from 'react'
import type { SupportedLocale } from '@/lib/shared/i18n'

/**
 * The language the document advertises in `<html lang>` (see `documentLocale`):
 * the reader's on localized pages, English on the ones that stay English, such
 * as most of admin. The root provides it so the error pages can match the page
 * around them. Null outside the root document.
 */
export const DocumentLocaleContext = createContext<SupportedLocale | null>(null)
