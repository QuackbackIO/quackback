import { useState } from 'react'

/**
 * Puts a file straight into storage at a presigned address and hands back its
 * key, saying while it works and what went wrong when it does.
 */
export function useImageUpload(
  presign: (file: File) => Promise<{ uploadUrl: string; key: string }>,
  /** The stored file's key, with the file itself for anything read from it. */
  onUploaded: (key: string, file: File) => void
) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  async function upload(file: File) {
    setBusy(true)
    setProblem(null)
    try {
      const { uploadUrl, key } = await presign(file)
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!put.ok) throw new Error(`${file.name} could not be uploaded.`)
      onUploaded(key, file)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That file could not be uploaded.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, problem, upload }
}
