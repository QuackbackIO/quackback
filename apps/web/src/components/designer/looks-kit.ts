/**
 * What Compare looks takes from the builder, handed to it as one object.
 *
 * The chooser is its own chunk, loaded when it opens. A module it imported
 * from the builder's chunks would be split out into a chunk of its own,
 * which every first open of the builder would then request (rolldown groups
 * a module by the chunks that load it). Handed over here, the chooser's
 * chunk imports nothing of the builder, and opening the builder loads what
 * it loaded before.
 */
import { onRadioKeys } from '@/components/admin/settings/appearance/radio-keys'
import { usePreviewPosting } from '@/components/admin/settings/branding/use-preview-posting'
import { PREVIEW_THEME } from '@/components/public/preview-draft-context'
import { canvasSrc } from '@/lib/shared/design/canvas-src'
import {
  LOOK_HINTS,
  LOOK_NAMES,
  LOOK_ORDER,
  LOOK_WIDTHS,
  lookFrameSize,
  shownView,
  withVariant,
} from '@/lib/shared/design/compare-looks'
import { useViewportWidth } from './ai-pane'
import { DeviceToggle } from './designer-header'
import { lookBase, looksViewChanged, takeLook } from './looks-entry'
import { ZoomControl } from './view-options'

export const LOOKS_KIT = {
  DeviceToggle,
  ZoomControl,
  useViewportWidth,
  onRadioKeys,
  usePreviewPosting,
  PREVIEW_THEME,
  canvasSrc,
  LOOK_HINTS,
  LOOK_NAMES,
  LOOK_ORDER,
  LOOK_WIDTHS,
  lookFrameSize,
  shownView,
  withVariant,
  lookBase,
  takeLook,
  looksViewChanged,
}

export type LooksKit = typeof LOOKS_KIT
