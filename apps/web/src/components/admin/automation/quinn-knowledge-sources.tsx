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
import { updateAssistantSourceUseFn } from '@/lib/server/functions/assistant-source-use'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'

const sourcesKey = ['assistant', 'knowledgeSources'] as const
export function QuinnKnowledgeSources({ kind }: { kind: 'document' | 'webpage' }) {
  const cache = useQueryClient()
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
                <p className="text-sm font-medium break-words">{row.title}</p>
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
