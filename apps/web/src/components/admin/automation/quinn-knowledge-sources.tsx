import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  listAssistantDocumentsFn,
  uploadAssistantDocumentFn,
  deleteAssistantDocumentFn,
} from '@/lib/server/functions/assistant-documents'
import {
  listWebSourcesFn,
  addWebSourceFn,
  deleteWebSourceFn,
  setWebSourceEnabledFn,
} from '@/lib/server/functions/assistant-web-sources'
import {
  getAssistantKnowledgeSourceFn,
  listAssistantSourceHealthFn,
  refreshAssistantSourceIndexFn,
  updateAssistantSourceUseFn,
} from '@/lib/server/functions/assistant-source-use'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'

const sourcesKey = ['assistant', 'knowledgeSources'] as const

/**
 * What a row says about its passages, and nothing when there is nothing to say.
 *
 * A source Quinn can read is the normal case and gets no label: the row is the
 * name and the switches, as it always was. Only the two states a person can act
 * on are named, and each one says what Quinn is doing about it rather than what
 * the index thinks of itself.
 */
export function indexNote(health?: {
  status: string
  serving: boolean
  degraded: string | null
}): string | null {
  if (!health) return null
  if (health.status === 'failed' && health.serving) return 'Update failed, using the last version'
  if (health.status === 'failed') return 'Not indexed'
  if (!health.serving) return 'Indexing'
  if (health.degraded === 'embeddings_unavailable') return 'Keyword search only'
  return null
}

export function QuinnKnowledgeSources({ kind }: { kind: 'document' | 'webpage' }) {
  const cache = useQueryClient()
  const [previewId, setPreviewId] = useState<string | null>(null)
  const preview = useQuery({
    queryKey: [...sourcesKey, 'preview', kind, previewId],
    queryFn: () => getAssistantKnowledgeSourceFn({ data: { kind, id: previewId! } }),
    enabled: previewId !== null,
    staleTime: 0,
  })
  const docs = useQuery({
    queryKey: [...sourcesKey, 'documents'],
    queryFn: listAssistantDocumentsFn,
    enabled: kind === 'document',
  })
  const pages = useQuery({
    queryKey: [...sourcesKey, 'webpages'],
    queryFn: listWebSourcesFn,
    enabled: kind === 'webpage',
  })
  const settings = useQuery(assistantQueries.settings())
  const sourceIds = ((kind === 'document' ? docs.data : pages.data) ?? []).map((row) => row.id)
  const health = useQuery({
    queryKey: [...sourcesKey, 'health', kind, sourceIds],
    queryFn: () => listAssistantSourceHealthFn({ data: { kind, ids: sourceIds } }),
    enabled: sourceIds.length > 0,
  })
  const healthById = new Map((health.data ?? []).map((row) => [row.id, row]))
  const refresh_ = useMutation({
    mutationFn: (id: string) => refreshAssistantSourceIndexFn({ data: { kind, id } }),
    onSuccess: () => cache.invalidateQueries({ queryKey: [...sourcesKey, 'health'] }),
    onError: (error: Error) => toast.error(error.message || 'Could not refresh this source.'),
  })
  const [url, setUrl] = useState('')
  const [removing, setRemoving] = useState<{
    kind: 'document' | 'webpage'
    id: string
    title: string
  } | null>(null)
  const refresh = () => cache.invalidateQueries({ queryKey: sourcesKey })
  const onError = (error: Error) => toast.error(error.message || 'Could not update knowledge.')
  const update = useMutation({
    mutationFn: (data: Parameters<typeof updateAssistantSourceUseFn>[0]['data']) =>
      updateAssistantSourceUseFn({ data }),
    onSuccess: refresh,
    onError,
  })
  const enablePage = useMutation({
    mutationFn: (id: string) => setWebSourceEnabledFn({ data: { id, enabled: true } }),
    onSuccess: refresh,
    onError,
  })
  const addPage = useMutation({
    mutationFn: () => addWebSourceFn({ data: { url } }),
    onSuccess: async () => {
      setUrl('')
      await refresh()
    },
    onError,
  })
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a document smaller than 5 MB.')
      const mimeType = file.name.toLowerCase().endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf'
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      return uploadAssistantDocumentFn({
        data: { title: file.name, fileName: file.name, mimeType, dataBase64: btoa(binary) },
      })
    },
    onSuccess: refresh,
    onError,
  })
  const remove = useMutation({
    mutationFn: async () => {
      if (!removing) return
      if (removing.kind === 'document')
        await deleteAssistantDocumentFn({ data: { id: removing.id } })
      else await deleteWebSourceFn({ data: { id: removing.id } })
    },
    onSuccess: async () => {
      setRemoving(null)
      await refresh()
    },
    onError,
  })

  return (
    <div className="space-y-6">
      {[kind].map((kind) => {
        const query = kind === 'document' ? docs : pages
        const rows = query.data ?? []
        const type = kind === 'document' ? 'documents' : 'webPages'
        return (
          <section key={kind} className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
            <h2 className="text-sm font-medium">
              {kind === 'document' ? 'Documents' : 'Web pages'}
              {query.data && ` · ${rows.length}`}
            </h2>
            {query.isPending && (
              <p role="status" className="text-sm">
                Loading sources…
              </p>
            )}
            {query.isError && (
              <div role="alert">
                <p>Sources could not be loaded.</p>
                <Button variant="outline" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              </div>
            )}
            {query.isSuccess && !rows.length && (
              <p className="text-sm text-muted-foreground">No sources added yet.</p>
            )}
            {rows.map((row) => (
              <div key={row.id} className="border-t pt-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">{row.title}</p>
                    {('url' in row || row.fileName !== row.title) && (
                      <p className="mt-1 text-xs text-muted-foreground break-words">
                        {'url' in row ? row.url : row.fileName}
                      </p>
                    )}
                    {'fetchedAt' in row && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fetched {new Date(row.fetchedAt).toLocaleString()}
                      </p>
                    )}
                    {indexNote(healthById.get(row.id)) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {indexNote(healthById.get(row.id))}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Open ${row.title}`}
                    onClick={() => setPreviewId(row.id)}
                  >
                    Open
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  {(['customer', 'team'] as const).map((use) => {
                    const allowed =
                      settings.data?.config.agents[use === 'customer' ? 'agent' : 'copilot']
                        .knowledge[type] === true && !('enabled' in row && row.enabled === false)
                    return (
                      <label key={use} className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={
                            use === 'customer' ? row.assistantCustomerUse : row.assistantTeamUse
                          }
                          disabled={!allowed || update.isPending}
                          onCheckedChange={(enabled) =>
                            update.mutate({ kind, id: row.id, use, enabled })
                          }
                          aria-label={`${row.title}: ${use === 'customer' ? 'Customer conversations' : 'Support teammates'}`}
                        />
                        {use === 'customer' ? 'Customer conversations' : 'Support teammates'}
                        {!allowed && (
                          <span className="text-muted-foreground">(source type or source off)</span>
                        )}
                      </label>
                    )
                  })}
                  {'enabled' in row && row.enabled === false && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={enablePage.isPending}
                      onClick={() => enablePage.mutate(row.id)}
                    >
                      Enable source
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={refresh_.isPending}
                    onClick={() => refresh_.mutate(row.id)}
                  >
                    Refresh
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoving({ kind, id: row.id, title: row.title })}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            {kind === 'document' ? (
              <div className="space-y-1">
                <Input
                  id="quinn-document-upload"
                  type="file"
                  aria-label="Upload knowledge document"
                  accept=".pdf,.docx"
                  disabled={upload.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) upload.mutate(file)
                    e.target.value = ''
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {upload.isPending ? 'Processing document…' : 'PDF or Word document, up to 5 MB.'}
                </p>
              </div>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  addPage.mutate()
                }}
              >
                <Input
                  id="quinn-web-page-url"
                  aria-label="Web page URL"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  placeholder="https://example.com/help"
                  disabled={addPage.isPending}
                />
                <Button type="submit" disabled={addPage.isPending || !url}>
                  {addPage.isPending ? 'Adding…' : 'Add page'}
                </Button>
              </form>
            )}
          </section>
        )
      })}
      <Dialog
        open={previewId !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{preview.data?.title ?? 'Knowledge source'}</DialogTitle>
          </DialogHeader>
          {preview.isPending && <p role="status">Loading source…</p>}
          {preview.isError && (
            <div role="alert">
              <p>This source could not be loaded.</p>
              <Button variant="outline" onClick={() => void preview.refetch()}>
                Try again
              </Button>
            </div>
          )}
          {preview.data && (
            <>
              <p className="break-words text-xs text-muted-foreground">
                {preview.data.origin} · Updated {new Date(preview.data.updatedAt).toLocaleString()}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">{preview.data.text}</p>
              {preview.data.truncated && (
                <p className="text-xs text-muted-foreground">
                  Showing the first 20,000 characters of the stored source.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null)
        }}
        title="Remove this source?"
        description={`Quinn will stop using ${removing?.title ?? 'this source'}.`}
        confirmLabel="Remove"
        variant="destructive"
        isPending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
