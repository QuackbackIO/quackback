import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'

interface TranscriptFile {
  filename: string
  content: string
  mimeType: string
}

/**
 * Agent action: download a thread as a markdown transcript (records, compliance,
 * handoff). The server renders the file; this just triggers the browser
 * download. Works for any thread — the caller supplies the loader (a
 * conversation or ticket export fn). Agent-only: transcripts include internal
 * notes.
 */
export function ExportTranscriptButton({ load }: { load: () => Promise<TranscriptFile> }) {
  const [busy, setBusy] = useState(false)

  const onExport = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { filename, content, mimeType } = await load()
      const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not export the transcript. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={() => void onExport()}
      disabled={busy}
    >
      <ArrowDownTrayIcon className="h-4 w-4" /> {busy ? 'Exporting…' : 'Export transcript'}
    </Button>
  )
}
