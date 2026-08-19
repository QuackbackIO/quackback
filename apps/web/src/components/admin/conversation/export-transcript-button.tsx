export interface TranscriptFile {
  filename: string
  content: string
  mimeType: string
}

/**
 * Trigger a browser download of an already-rendered transcript file. Shared by
 * every "Export transcript" affordance (the unified thread header's overflow
 * menu item, unified inbox §2.7) so each call site uses one download mechanic.
 */
export async function downloadTranscriptFile(load: () => Promise<TranscriptFile>): Promise<void> {
  const { filename, content, mimeType } = await load()
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
