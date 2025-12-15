import Image from 'next/image'
import Link from 'next/link'

export function PoweredByFooter() {
  return (
    <footer className="py-4 mt-auto">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <span>Powered by</span>
          <Link
            href="https://quackback.io"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1 font-medium hover:text-foreground transition-colors"
          >
            <Image
              src="/logo.png"
              alt=""
              width={16}
              height={16}
              className="opacity-70 group-hover:opacity-100 transition-opacity"
            />
            Quackback
          </Link>
        </p>
      </div>
    </footer>
  )
}
