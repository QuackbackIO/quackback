import { ensureStyles } from './style'

export interface PanelOptions {
  /** Widget URL — e.g. "https://feedback.acme.com/widget". */
  widgetUrl: string
  placement: 'left' | 'right'
  defaultBoard?: string
  showCloseButton?: boolean
  locale?: string
  onBackdropClick: () => void
}

export interface PanelHandle {
  iframe: HTMLIFrameElement
  show(): void
  hide(): void
  destroy(): void
}

export function createPanel(opts: PanelOptions): PanelHandle {
  ensureStyles(opts.placement)

  const params: string[] = []
  if (opts.defaultBoard) params.push(`board=${encodeURIComponent(opts.defaultBoard)}`)
  if (opts.showCloseButton) params.push('showClose=1')
  if (opts.locale) params.push(`locale=${encodeURIComponent(opts.locale)}`)
  const url = opts.widgetUrl + (params.length ? '?' + params.join('&') : '')

  const backdrop = document.createElement('div')
  backdrop.className = 'quackback-backdrop'
  backdrop.addEventListener('click', opts.onBackdropClick)
  document.body.appendChild(backdrop)

  const panel = document.createElement('div')
  panel.className = 'quackback-panel quackback-widget-iframe-wrapper'
  document.body.appendChild(panel)

  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: 'none',
    colorScheme: 'normal',
  })
  iframe.setAttribute('src', url)
  iframe.setAttribute('title', 'Feedback Widget')
  iframe.setAttribute(
    'sandbox',
    'allow-scripts allow-forms allow-same-origin allow-popups allow-downloads'
  )
  iframe.setAttribute('allow', 'clipboard-write')
  iframe.className = 'quackback-widget-iframe'
  panel.appendChild(iframe)

  let open = false

  return {
    iframe,
    show() {
      if (open) return
      open = true
      panel.classList.remove('quackback-closing')
      backdrop.classList.remove('quackback-closing')
      void panel.offsetHeight // force reflow
      panel.classList.add('quackback-open')
      backdrop.classList.add('quackback-open')
    },
    hide() {
      if (!open) return
      open = false
      panel.classList.remove('quackback-open')
      panel.classList.add('quackback-closing')
      backdrop.classList.remove('quackback-open')
      backdrop.classList.add('quackback-closing')
      setTimeout(() => {
        panel.classList.remove('quackback-closing')
        backdrop.classList.remove('quackback-closing')
      }, 300)
    },
    destroy() {
      panel.remove()
      backdrop.remove()
    },
  }
}
