/**
 * Whether an Office file can carry macros, for the engines' notes. No engine
 * ever runs one; the note tells people before they open the download.
 */
import type { IntlShape } from 'react-intl'
import { fileExtension } from '@/lib/shared/files/file-types'
import type { ViewerFile } from '../types'

const MACRO_EXTENSIONS = new Set(['docm', 'dotm', 'xlsm', 'xltm', 'xlam'])

/** The preview job found a macro part, or the file is a macro-enabled type. */
export function mayHaveMacros(file: Pick<ViewerFile, 'name' | 'contentType' | 'preview'>): boolean {
  return (
    file.preview?.macro === true ||
    MACRO_EXTENSIONS.has(fileExtension(file.name)) ||
    /macroenabled/i.test(file.contentType)
  )
}

/** "Contains macros" when the file may carry them. */
export function macroNote(
  file: Pick<ViewerFile, 'name' | 'contentType' | 'preview'>,
  intl: IntlShape
): string | undefined {
  return mayHaveMacros(file)
    ? intl.formatMessage({ id: 'files.macros', defaultMessage: 'Contains macros' })
    : undefined
}
