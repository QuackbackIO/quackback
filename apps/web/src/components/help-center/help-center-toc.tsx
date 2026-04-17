'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/shared/utils'
import type { TocHeading } from './help-center-article-utils'

interface HelpCenterTocProps {
  headings: TocHeading[]
}

export function HelpCenterToc({ headings }: HelpCenterTocProps) {
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
            break
          }
        }
      },
      { rootMargin: '-24px 0% -80% 0%', threshold: 0 }
    )

    for (const heading of headings) {
      const el = document.getElementById(heading.id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <aside className="sticky top-14 h-[calc(100vh-3.5rem)] hidden flex-col py-8 pl-6 pr-6 xl:flex">
      <p className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        On this page
      </p>
      <nav className="min-h-0 flex-1 overflow-y-auto">
        <ul className="border-l border-border space-y-0.5">
          {headings.map((heading) => (
            <li key={heading.id} style={{ paddingLeft: heading.level === 3 ? '20px' : '0px' }}>
              <a
                href={`#${heading.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth' })
                  setActiveId(heading.id)
                }}
                className={cn(
                  'block -ml-px border-l-2 py-1 pl-3 text-[13px] leading-snug transition-colors',
                  activeId === heading.id
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
