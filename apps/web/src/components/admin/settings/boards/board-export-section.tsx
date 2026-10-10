import { useState } from 'react'
import { z } from 'zod'
import { ArrowDownTrayIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/shared/form-error'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'

const errorResponseSchema = z.object({
  error: z.string().optional(),
})

interface BoardExportSectionProps {
  boardId: string
}

export function BoardExportSection({ boardId }: BoardExportSectionProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    setError(null)
    setIsExporting(true)

    try {
      const params = new URLSearchParams({
        boardId,
      })

      const response = await fetch(`/api/export?${params}`)

      if (!response.ok) {
        const data = errorResponseSchema.parse(await response.json())
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
    <div>
      <SettingRows>
        <SettingRow
          label="Export posts"
          description="Download this board's posts as a CSV file."
          control={
            <Button variant="outline" size="sm" onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <>
                  <ArrowPathIcon className="size-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <ArrowDownTrayIcon className="size-4" />
                  Export CSV
                </>
              )}
            </Button>
          }
        />
      </SettingRows>
      {error && <FormError message={error} />}
    </div>
  )
}
