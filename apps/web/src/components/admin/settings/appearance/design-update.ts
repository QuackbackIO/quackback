import { getBandImageUploadUrlFn } from '@/lib/server/functions/uploads'
import type { PortalDesign } from '@/lib/shared/design/schema'

/** Changes the draft design as one step. */
export type Update = (change: (draft: PortalDesign) => void) => void

/** Asks where a hero or background image goes, for an upload straight to storage. */
export const presignBandImage = async (file: File) =>
  getBandImageUploadUrlFn({
    data: { filename: file.name, contentType: file.type, fileSize: file.size },
  })
