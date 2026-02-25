import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/solid'

export function FilterSection({
  title,
  children,
  hint,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  hint?: string
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="pb-4 last:pb-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {title}
        {isOpen ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
      </button>
      {isOpen && (
        <div className="mt-2">
          {children}
          {hint && <p className="mt-2 text-[10px] text-muted-foreground/60">{hint}</p>}
        </div>
      )}
    </div>
  )
}
