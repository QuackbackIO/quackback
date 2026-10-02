import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { copyWithFallback } from '@/components/admin/activation-action-button'

/** One click copies the install prompt for the user's coding agent. */
export function CopyAgentPromptButton({
  getPrompt,
  className,
  disabled,
}: {
  getPrompt: () => string | Promise<string>
  className?: string
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  async function handleClick() {
    const text = await getPrompt()
    if (!text) return
    try {
      await copyWithFallback(text)
    } catch {
      return
    }
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setCopied(false)
    }, 2000)
  }

  return (
    <Button
      type="button"
      onClick={() => void handleClick()}
      disabled={disabled}
      className={className}
      aria-label={copied ? 'Prompt copied' : 'Copy install prompt'}
    >
      {copied ? <CheckIcon className="size-4" /> : <ClipboardDocumentIcon className="size-4" />}
      {copied ? 'Prompt copied' : 'Copy install prompt'}
    </Button>
  )
}
