'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, FileText, X, Loader2, CheckCircle2, AlertCircle, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { CSV_TEMPLATE } from '@/lib/schemas/import'
import type { ImportJobStatus } from '@quackback/jobs'

interface BoardImportSectionProps {
  boardId: string
}

type ImportState = 'idle' | 'uploading' | 'processing' | 'completed' | 'failed'

export function BoardImportSection({ boardId }: BoardImportSectionProps) {
  const [state, setState] = useState<ImportState>('idle')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<ImportJobStatus | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const pollFailureCountRef = useRef(0)

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

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

  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/import/${jobId}`)
      if (!response.ok) throw new Error('Failed to fetch job status')

      const status: ImportJobStatus = await response.json()
      setJobStatus(status)
      pollFailureCountRef.current = 0

      if (status.status === 'completed' || status.status === 'failed') {
        if (status.status === 'failed') {
          setState('failed')
          setError(status.error || 'Import failed')
        } else {
          setState('completed')
        }
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
      }
    } catch {
      pollFailureCountRef.current++
      if (pollFailureCountRef.current >= 5) {
        setState('failed')
        setError('Lost connection to import job. Please refresh the page.')
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
      }
    }
  }, [])

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
        const data = await response.json()
        throw new Error(data.error || 'Import failed')
      }

      const data = await response.json()
      setState('processing')
      setJobStatus({
        jobId: data.jobId,
        status: 'waiting',
        progress: { processed: 0, total: data.totalRows },
      })

      pollIntervalRef.current = setInterval(() => pollJobStatus(data.jobId), 2000)
      pollJobStatus(data.jobId)
    } catch (err) {
      setState('failed')
      setError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  const handleReset = () => {
    setState('idle')
    setSelectedFile(null)
    setError(null)
    setJobStatus(null)
    pollFailureCountRef.current = 0
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
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

  const progress = jobStatus?.progress
    ? Math.round((jobStatus.progress.processed / jobStatus.progress.total) * 100)
    : 0

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm p-6">
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
                <FileText className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">{selectedFile.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedFile(null)
                  }}
                  className="p-1 hover:bg-muted rounded"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
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
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <Button onClick={handleImport} disabled={!selectedFile}>
              <Upload className="h-4 w-4 mr-2" />
              Import Data
            </Button>
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>
        </>
      )}

      {(state === 'uploading' || state === 'processing') && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">
              {state === 'uploading' ? 'Uploading...' : 'Processing...'}
            </span>
          </div>
          {jobStatus?.progress && (
            <>
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-muted-foreground">
                {jobStatus.progress.processed} / {jobStatus.progress.total} rows processed
              </p>
            </>
          )}
        </div>
      )}

      {state === 'completed' && jobStatus?.result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Import Complete</span>
          </div>
          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <p>
              <span className="font-medium">{jobStatus.result.imported}</span> posts imported
            </p>
            {jobStatus.result.skipped > 0 && (
              <p className="text-amber-600">
                <span className="font-medium">{jobStatus.result.skipped}</span> rows skipped
              </p>
            )}
            {jobStatus.result.createdTags.length > 0 && (
              <p>
                <span className="font-medium">{jobStatus.result.createdTags.length}</span> new tags
                created
              </p>
            )}
            {jobStatus.result.errors.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  View {jobStatus.result.errors.length} error(s)
                </summary>
                <ul className="mt-2 space-y-1 text-destructive">
                  {jobStatus.result.errors.slice(0, 10).map((err, i) => (
                    <li key={i}>
                      Row {err.row}: {err.message}
                    </li>
                  ))}
                  {jobStatus.result.errors.length > 10 && (
                    <li>...and {jobStatus.result.errors.length - 10} more</li>
                  )}
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
            <AlertCircle className="h-5 w-5" />
            <span className="font-medium">Import Failed</span>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleReset} variant="outline">
            Try Again
          </Button>
        </div>
      )}
    </div>
  )
}
