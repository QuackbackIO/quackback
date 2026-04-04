'use client'

import { useEffect, useRef, useState } from 'react'
import type { TocHeading } from './help-center-article-utils'

interface HelpCenterTocProps {
  headings: TocHeading[]
}

export function HelpCenterToc({ headings }: HelpCenterTocProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    if (headings.length === 0) return

    // Disconnect previous observer
    observerRef.current?.disconnect()

    const callback: IntersectionObserverCallback = (entries) => {
      // Find the first visible heading (top-down)
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

      if (visible.length > 0) {
        setActiveId(visible[0].target.id)
      }
    }

    observerRef.current = new IntersectionObserver(callback, {
      rootMargin: '-80px 0px -60% 0px',
      threshold: 0,
    })

    for (const heading of headings) {
      const el = document.getElementById(heading.id)
      if (el) observerRef.current.observe(el)
    }

    return () => observerRef.current?.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav className="hidden xl:block w-40 shrink-0" aria-label="Table of contents">
      <div className="sticky top-20">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          On this page
        </p>
        <ul className="space-y-1">
          {headings.map((heading) => {
            const isActive = activeId === heading.id
            return (
              <li key={heading.id}>
                <a
                  href={`#${heading.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    const el = document.getElementById(heading.id)
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth' })
                      setActiveId(heading.id)
                    }
                  }}
                  className={`block text-xs leading-relaxed transition-colors ${
                    heading.level === 3 ? 'pl-3' : ''
                  } ${
                    isActive
                      ? 'border-l-2 border-primary pl-2 text-foreground font-medium'
                      : 'border-l-2 border-transparent pl-2 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {heading.text}
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
