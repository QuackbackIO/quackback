'use client'

import { useState } from 'react'
import {
  CheckIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ApiKeyRevealDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  keyValue: string | null
  keyName: string
  onClose?: () => void
}

export function ApiKeyRevealDialog({
  open,
  onOpenChange,
  keyValue,
  keyName,
  onClose,
}: ApiKeyRevealDialogProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!keyValue) return

    try {
      await navigator.clipboard.writeText(keyValue)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setCopied(false)
      onClose?.()
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API Key Created</DialogTitle>
          <DialogDescription>
            Your API key <strong>{keyName}</strong> has been created successfully.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-4">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                Copy your API key now
              </p>
              <p className="text-muted-foreground mt-1">
                This is the only time you will see this key. Store it securely and never share it
                publicly.
              </p>
            </div>
          </div>

          {/* Key display */}
          <div className="space-y-2">
            <label htmlFor="api-key-value" className="text-sm font-medium">
              Your API Key
            </label>
            <div className="flex items-center gap-2">
              <code
                id="api-key-value"
                className="flex-1 rounded-lg bg-muted px-3 py-2.5 font-mono text-sm break-all"
              >
                {keyValue}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopy}
                className="shrink-0"
                aria-label="Copy API key to clipboard"
              >
                {copied ? (
                  <CheckIcon className="h-4 w-4 text-green-500" />
                ) : (
                  <ClipboardDocumentIcon className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Usage example */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Usage</label>
            <div className="rounded-lg bg-muted p-3">
              <code className="text-xs text-muted-foreground block">
                curl -H "Authorization: Bearer {keyValue ? keyValue.slice(0, 20) + '...' : ''}" \
                <br />
                &nbsp;&nbsp;https://yoursite.com/api/v1/posts
              </code>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => handleOpenChange(false)}>
            {copied ? 'Done' : "I've saved my key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
