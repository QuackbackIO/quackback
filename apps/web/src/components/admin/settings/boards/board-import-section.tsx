import { useState, useRef, useCallback } from 'react'
import { z } from 'zod'
import {
  ArrowUpTrayIcon,
  DocumentTextIcon,
  XMarkIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { CSV_TEMPLATE } from '@/lib/shared/schemas/import'
import type { ImportResult } from '@/lib/shared/types'

const errorResponseSchema = z.object({
  error: z.string().optional(),
})

const importResponseSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({ row: z.number(), message: z.string() })),
  createdTags: z.array(z.string()),
})

interface BoardImportSectionProps {
  boardId: string
}

type ImportState = 'idle' | 'uploading' | 'completed' | 'failed'

export function BoardImportSection({ boardId }: BoardImportSectionProps) {
  const [state, setState] = useState<ImportState>('idle')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback((file: File) => {
    setError(null)
    if (!file.type.includes('csv') && !file.name.endsWith('.csv')) {
      setError('Please select a CSV file')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB')
      return
    }
    setSelectedFile(file)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) handleFileSelect(file)
    },
    [handleFileSelect]
  )

  const handleImport = async () => {
    if (!selectedFile) return

    setError(null)
    setState('uploading')

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('boardId', boardId)

      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = errorResponseSchema.parse(await response.json())
        throw new Error(data.error || 'Import failed')
      }

      const data = importResponseSchema.parse(await response.json())

      // Import is now synchronous - results are returned immediately
      setResult({
        imported: data.imported,
        skipped: data.skipped,
        errors: data.errors,
        createdTags: data.createdTags,
      })
      setState('completed')
    } catch (err) {
      setState('failed')
      setError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  const handleReset = () => {
    setState('idle')
    setSelectedFile(null)
    setError(null)
    setResult(null)
  }

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      {state === 'idle' && (
        <>
          <div
            className="border-2 border-dashed border-border/50 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />
            {selectedFile ? (
              <div className="flex items-center justify-center gap-2">
                <DocumentTextIcon className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">{selectedFile.name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove file"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedFile(null)
                  }}
                >
                  <XMarkIcon className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ) : (
              <>
                <ArrowUpTrayIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Drop a CSV file here or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Maximum 10MB, up to 10,000 rows
                </p>
              </>
            )}
          </div>

          {error && (
            <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg flex items-center gap-2">
              <ExclamationCircleIcon className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
            <Button onClick={handleImport} disabled={!selectedFile} className="w-full sm:w-auto">
              <ArrowUpTrayIcon className="size-4" />
              Import Data
            </Button>
            <Button variant="outline" onClick={downloadTemplate} className="w-full sm:w-auto">
              <ArrowDownTrayIcon className="size-4" />
              Download Template
            </Button>
          </div>
        </>
      )}

      {state === 'uploading' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <ArrowPathIcon className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">Processing import...</span>
          </div>
        </div>
      )}

      {state === 'completed' && result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-primary">
            <CheckCircleIcon className="h-5 w-5" />
            <span className="font-medium">Import Complete</span>
          </div>
          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <p>
              <span className="font-medium">{result.imported}</span> posts imported
            </p>
            {result.skipped > 0 && (
              <p className="text-muted-foreground">
                <span className="font-medium">{result.skipped}</span> rows skipped
              </p>
            )}
            {result.createdTags.length > 0 && (
              <p>
                <span className="font-medium">{result.createdTags.length}</span> new tags created
              </p>
            )}
            {result.errors.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  View {result.errors.length} error(s)
                </summary>
                <ul className="mt-2 space-y-1 text-destructive">
                  {result.errors.slice(0, 10).map((err, i) => (
                    <li key={i}>
                      Row {err.row}: {err.message}
                    </li>
                  ))}
                  {result.errors.length > 10 && <li>...and {result.errors.length - 10} more</li>}
                </ul>
              </details>
            )}
          </div>
          <Button onClick={handleReset}>Import More</Button>
        </div>
      )}

      {state === 'failed' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-destructive">
            <ExclamationCircleIcon className="h-5 w-5" />
            <span className="font-medium">Import Failed</span>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleReset} variant="outline">
            Try Again
          </Button>
        </div>
      )}
    </>
  )
}
