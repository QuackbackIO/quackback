'use client'

import { useState } from 'react'
import { Download, Loader2, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BoardExportSectionProps {
  workspaceId: string
  boardId: string
}

export function BoardExportSection({ workspaceId, boardId }: BoardExportSectionProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    setError(null)
    setIsExporting(true)

    try {
      const params = new URLSearchParams({
        workspaceId,
        boardId,
      })

      const response = await fetch(`/api/export?${params}`)

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Export failed')
      }

      const contentDisposition = response.headers.get('Content-Disposition')
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/)
      const filename = filenameMatch ? filenameMatch[1] : `posts-export-${Date.now()}.csv`

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
          <Download className="h-5 w-5 text-green-500" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">Export to CSV</h2>
          <p className="text-sm text-muted-foreground">Download all posts from this board</p>
        </div>
      </div>

      <div className="bg-muted/50 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileDown className="h-4 w-4" />
          <span>
            Includes: title, content, status, tags, author info, vote count, and creation date
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
          {error}
        </div>
      )}

      <Button onClick={handleExport} disabled={isExporting}>
        {isExporting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Exporting...
          </>
        ) : (
          <>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </>
        )}
      </Button>
    </div>
  )
}
