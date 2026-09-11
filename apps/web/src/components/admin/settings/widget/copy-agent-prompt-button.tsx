import { useEffect, useRef, useState } from 'react'
import { CheckIcon } from '@heroicons/react/24/solid'
import { AGENT_BRANDS } from '@/components/admin/settings/widget/agent-brand-icons'
import { copyWithFallback } from '@/components/admin/activation-action-button'
import { cn } from '@/lib/shared/utils'

/**
 * Cloudflare-style agent onboard pill: one click copies the install prompt,
 * with brand marks for the agents people actually paste into.
 */
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
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={disabled}
      aria-label={copied ? 'Install prompt copied' : 'Copy install prompt for your coding agent'}
      className={cn(
        'group inline-flex items-center gap-3 rounded-full bg-zinc-950 pl-4 pr-2 py-1.5',
        'text-[13px] font-medium text-white shadow-sm',
        'ring-1 ring-white/10 hover:ring-white/20',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
    >
      <span className="whitespace-nowrap">
        {copied ? 'Prompt copied' : 'Copy prompt for your agent'}
      </span>
      <span className="flex items-center gap-1.5" aria-hidden="true">
        {copied ? (
          <CheckIcon className="size-4 text-emerald-400" />
        ) : (
          AGENT_BRANDS.map(({ id, Icon, className: iconClass }) => (
            <Icon key={id} className={cn('size-4', iconClass)} />
          ))
        )}
      </span>
    </button>
  )
}
