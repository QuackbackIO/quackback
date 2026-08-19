import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { adminQueries } from '@/lib/client/queries/admin'
import { CSV_TEMPLATE } from '@/lib/shared/schemas/import'
import type { ImportRunListItem } from './import-history-list'

type Step = 'idle' | 'reviewing' | 'committing' | 'done' | 'failed'

interface PreviewResponse {
  totalRows: number
  counts: {
    byBoard: Record<string, number>
    byStatus: Record<string, number>
    byAuthor: Record<string, number>
  }
  creates: { boards: string[]; statuses: string[]; tags: string[] }
  sample: {
    row: number
    title: string
    board: string | null
    status: string | null
    author: string
    isNewAuthor: boolean
    voteCount: number
    action: 'create' | 'update'
  }[]
  errors: { row: number; message: string; field?: string }[]
  updatedCount: number
}

const IN_FLIGHT_RUN_STATUSES = new Set(['pending', 'dry_run', 'running'])

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Template-driven CSV import: download the template, fill it in, upload,
 * review the dry-run (counts + what would be auto-created), commit. The
 * server contract is the template itself — no column-mapping step.
 */
export function ImportCsv() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [boardId, setBoardId] = useState<string>('')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const boardsQuery = useQuery(adminQueries.boardsForSettings())
  const boards = boardsQuery.data ?? []

  const runQuery = useQuery({
    queryKey: ['import-run', runId],
    enabled: step === 'committing' && runId != null,
    refetchInterval: (query) => {
      const run = query.state.data as ImportRunListItem | undefined
      return run && IN_FLIGHT_RUN_STATUSES.has(run.status) ? 1500 : false
    },
    queryFn: async () => {
      const res = await fetch(`/api/import/runs/${runId}`)
      if (!res.ok) throw new Error('Failed to load import run')
      const body = (await res.json()) as { run: ImportRunListItem }
      return body.run
    },
  })
  const run = runQuery.data as ImportRunListItem | undefined

  // Flip out of the polling step once the run settles.
  useEffect(() => {
    if (step === 'committing' && run && !IN_FLIGHT_RUN_STATUSES.has(run.status)) {
      setStep(run.status === 'completed' ? 'done' : 'failed')
      void queryClient.invalidateQueries({ queryKey: ['import-runs'] })
    }
  }, [step, run, queryClient])

  function reset() {
    setStep('idle')
    setFile(null)
    setPreview(null)
    setRunId(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function buildFormData(mode: 'dry_run' | 'commit'): FormData {
    const formData = new FormData()
    formData.append('file', file!)
    if (boardId) formData.append('boardId', boardId)
    formData.append('mode', mode)
    return formData
  }

  async function handleFileChosen(chosen: File) {
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        body: buildFormDataFor(chosen, boardId, 'dry_run'),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(body.error ?? 'Could not read that CSV')
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
      setFile(chosen)
      setPreview(body as PreviewResponse)
      setStep('reviewing')
    } catch {
      toast.error('Could not read that CSV')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleCommit() {
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/import', { method: 'POST', body: buildFormData('commit') })
      const body = await res.json()
      if (res.status !== 202) {
        toast.error(body.error ?? 'Could not start the import')
        return
      }
      setRunId(body.runId as string)
      setStep('committing')
    } catch {
      toast.error('Could not start the import')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (step === 'committing' || step === 'done' || step === 'failed') {
    return <ImportProgress step={step} run={run} onReset={reset} />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={boardId} onValueChange={setBoardId}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="Default board (optional)" />
          </SelectTrigger>
          <SelectContent>
            {boards.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={downloadTemplate}>
          <ArrowDownTrayIcon className="size-4" />
          Download template
        </Button>
      </div>

      {step === 'idle' && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center transition-colors hover:bg-muted/40">
          <ArrowUpTrayIcon className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium">
            {isSubmitting
              ? 'Reading CSV…'
              : file
                ? file.name
                : 'Drop your CSV here, or click to browse'}
          </span>
          <span className="text-xs text-muted-foreground">
            Must use the template columns — title and content are required. Up to 10MB / 10,000
            rows.
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={isSubmitting}
            onChange={(e) => {
              const chosen = e.target.files?.[0]
              if (chosen) void handleFileChosen(chosen)
            }}
          />
        </label>
      )}

      {step === 'reviewing' && preview && (
        <ImportReview
          preview={preview}
          fileName={file?.name ?? ''}
          isSubmitting={isSubmitting}
          onCommit={handleCommit}
          onReset={reset}
        />
      )}
    </div>
  )
}

function buildFormDataFor(file: File, boardId: string, mode: 'dry_run' | 'commit'): FormData {
  const formData = new FormData()
  formData.append('file', file)
  if (boardId) formData.append('boardId', boardId)
  formData.append('mode', mode)
  return formData
}

function ImportReview({
  preview,
  fileName,
  isSubmitting,
  onCommit,
  onReset,
}: {
  preview: PreviewResponse
  fileName: string
  isSubmitting: boolean
  onCommit: () => void
  onReset: () => void
}) {
  const creations = [
    ...preview.creates.boards.map((name) => `${name} (board)`),
    ...preview.creates.statuses.map((name) => `${name} (status)`),
    ...preview.creates.tags.map((name) => `${name} (tag)`),
  ]
  const willCreate = preview.totalRows - preview.updatedCount - preview.errors.length

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm font-medium">{fileName}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {preview.totalRows} rows: {willCreate} new posts, {preview.updatedCount} updates,{' '}
          {preview.errors.length} skipped with errors.
        </p>
        {creations.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Will create: {creations.join(', ')} — anything not already in your workspace is created
            on import.
          </p>
        )}
      </div>

      {preview.errors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
          {preview.errors.slice(0, 5).map((err) => (
            <p key={err.row} className="text-destructive">
              Row {err.row}: {err.message}
            </p>
          ))}
          {preview.errors.length > 5 && (
            <p className="mt-1 text-muted-foreground">
              …and {preview.errors.length - 5} more (full list available in import history after the
              run).
            </p>
          )}
        </div>
      )}

      {preview.sample.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Board</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Author</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.sample.map((row) => (
                <TableRow key={row.row}>
                  <TableCell className="text-muted-foreground">{row.row}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={row.title}>
                    {row.title}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.board ?? 'default'}</TableCell>
                  <TableCell className="text-muted-foreground">{row.status ?? 'default'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.author}
                    {row.isNewAuthor && (
                      <Badge variant="secondary" className="ml-1.5">
                        new
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={row.action === 'update' ? 'default' : 'outline'}>
                      {row.action === 'update' ? 'Update' : 'Create'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={onCommit} disabled={isSubmitting}>
          {isSubmitting ? 'Starting…' : `Import ${willCreate} posts`}
        </Button>
        <Button variant="ghost" onClick={onReset} disabled={isSubmitting}>
          Choose a different file
        </Button>
      </div>
    </div>
  )
}

function ImportProgress({
  step,
  run,
  onReset,
}: {
  step: Step
  run: ImportRunListItem | undefined
  onReset: () => void
}) {
  if (step === 'committing') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border p-4">
        <ArrowDownTrayIcon className="size-5 animate-pulse text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Importing… this usually takes a few seconds.
        </p>
      </div>
    )
  }

  if (step === 'done' && run?.totals) {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <CheckCircleIcon className="size-5 text-green-600" />
          <p className="text-sm font-medium">Import complete</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {run.totals.created} created
          {run.totals.updated > 0 && `, ${run.totals.updated} updated`}
          {run.totals.skipped > 0 && `, ${run.totals.skipped} skipped`}
          {run.totals.errors > 0 && ` (${run.totals.errors} row errors — see import history)`}.
        </p>
        <Button variant="outline" size="sm" onClick={onReset}>
          Import another file
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 p-4">
      <div className="flex items-center gap-2">
        <ExclamationCircleIcon className="size-5 text-destructive" />
        <p className="text-sm font-medium">Import failed</p>
      </div>
      <p className="text-sm text-muted-foreground">
        {run?.errorReport?.[0]?.message ?? 'Something went wrong while importing.'}
      </p>
      <Button variant="outline" size="sm" onClick={onReset}>
        Try again
      </Button>
    </div>
  )
}
