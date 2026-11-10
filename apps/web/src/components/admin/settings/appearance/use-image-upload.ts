import { useState } from 'react'
import { prepareHeroImage } from '@/lib/client/hero-image'

type Presign = (file: File) => Promise<{ uploadUrl: string; key: string }>

/** Puts a file at a presigned address and hands back its key. */
async function store(presign: Presign, file: File, name = file.name): Promise<string> {
  const { uploadUrl, key } = await presign(file)
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (!put.ok) throw new Error(`${name} could not be uploaded.`)
  return key
}

/**
 * Puts a file straight into storage at a presigned address and hands back its
 * key, saying while it works and what went wrong when it does.
 */
export function useImageUpload(
  presign: Presign,
  /** The stored file's key, with the file itself for anything read from it. */
  onUploaded: (key: string, file: File) => void
) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  async function upload(file: File) {
    setBusy(true)
    setProblem(null)
    try {
      onUploaded(await store(presign, file), file)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That file could not be uploaded.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, problem, upload }
}

/** A hero image as stored: its key, its width when known, and its smaller copies. */
export interface StoredHero {
  key: string
  width?: number
  variants?: Array<{ key: string; w: number }>
}

/**
 * A hero image's upload: made no wider than a wide screen needs, with smaller
 * WebP copies the portal offers by width, all stored before the design is
 * told. A copy that fails to store is left out; the image itself must store.
 */
export function useHeroImageUpload(presign: Presign, onUploaded: (image: StoredHero) => void) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  async function upload(file: File) {
    setBusy(true)
    setProblem(null)
    try {
      const prepared = await prepareHeroImage(file)
      const key = await store(presign, prepared.file, file.name)
      const variants = (
        await Promise.all(
          prepared.copies.map((copy) =>
            store(presign, copy.file).then(
              (stored) => ({ key: stored, w: copy.width }),
              () => null
            )
          )
        )
      ).filter((each): each is { key: string; w: number } => each !== null)
      onUploaded({
        key,
        ...(prepared.width ? { width: prepared.width } : {}),
        ...(prepared.width && variants.length ? { variants } : {}),
      })
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That file could not be uploaded.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, problem, upload }
}
