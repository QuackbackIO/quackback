import type { ReactNode } from 'react'

/**
 * Home's one column. The chat-first Home and the frame shown while its code
 * loads both sit in it, so the first frame after setup does not move.
 */
export function HomeColumn({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="home-column"
      className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 sm:px-6"
    >
      {children}
    </div>
  )
}

/** The space around Home's greeting. */
export function HomeHeaderSpace({ children }: { children: ReactNode }) {
  return <div className="pt-10 pb-6 sm:pt-20">{children}</div>
}

/** The composer's height, so its place holds still while the chat loads. */
export const HOME_COMPOSER_HEIGHT = 'h-[138px]'

/**
 * The chat-first Home while its code loads: the same scroll area, column and
 * greeting, and the composer's place at the composer's own size.
 */
export function HomeLoadingFrame({ header }: { header: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <HomeColumn>
          <HomeHeaderSpace>{header}</HomeHeaderSpace>
          <div
            aria-hidden="true"
            data-slot="composer-placeholder"
            className={`${HOME_COMPOSER_HEIGHT} rounded-2xl border border-border bg-card shadow-float`}
          />
        </HomeColumn>
      </div>
    </div>
  )
}
