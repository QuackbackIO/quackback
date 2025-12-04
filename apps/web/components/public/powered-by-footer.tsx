import Image from 'next/image'
import Link from 'next/link'

export function PoweredByFooter() {
  return (
    <footer className="border-t border-border/30 py-4 mt-auto">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <Link
          href="https://quackback.io"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        >
          <Image src="/logo.png" alt="Quackback" width={16} height={16} className="opacity-70" />
          <span>Powered by</span>
          <span className="font-medium">Quackback</span>
        </Link>
      </div>
    </footer>
  )
}
