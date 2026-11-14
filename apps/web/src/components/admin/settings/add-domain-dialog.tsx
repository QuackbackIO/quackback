/**
 * Add a domain by its name, then open its page. What the domain is for is set
 * up there, one use at a time, so nothing here asks.
 */
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { errorText } from '@/lib/client/error-text'
import { addDomainFn } from '@/lib/server/functions/domains'
import { DOMAIN_VIEW_ROUTE } from '@/lib/shared/domain-uses'

export function AddDomainButton({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setName('')
      setError(null)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    setSaving(true)
    try {
      const added = await addDomainFn({ data: { name: name.trim() } })
      await navigate({ to: DOMAIN_VIEW_ROUTE, params: { domain: added.name } })
    } catch (err) {
      setError(errorText(err, "Couldn't add the domain."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        Add domain
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add domain</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit}>
            <div className="space-y-2 py-4">
              <Label htmlFor="add-domain-name">Domain</Label>
              <Input
                id="add-domain-name"
                value={name}
                placeholder="acme.com"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                autoFocus
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
