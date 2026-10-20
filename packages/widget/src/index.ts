import { createSDK } from './core/sdk'
import type {
  InitOptions,
  Identity,
  OpenOptions,
  WidgetUser,
  EventName,
  EventMap,
  EventHandler,
  Unsubscribe,
  AttachOptions,
  AttachResult,
  AttachError,
} from './types'

import { SDK_VERSION } from './version'

export { SDK_VERSION }
export type {
  InitOptions,
  Identity,
  OpenOptions,
  WidgetUser,
  EventName,
  EventMap,
  EventHandler,
  Unsubscribe,
  AttachOptions,
  AttachResult,
  AttachError,
}

const sdk = createSDK()

export const Quackback = {
  version: SDK_VERSION,
  init(options: InitOptions): void {
    sdk.dispatch('init', options)
  },
  identify(identity?: Identity): void {
    sdk.dispatch('identify', identity)
  },
  logout(): void {
    sdk.dispatch('logout')
  },
  open(options?: OpenOptions): void {
    sdk.dispatch('open', options)
  },
  close(): void {
    sdk.dispatch('close')
  },
  /**
   * Hand a file from the host page (a screenshot or a screen recording, say)
   * to the widget: it opens the chat view and stages the file in the composer,
   * where it uploads and sends like a file the visitor picked. Resolves once
   * the file is staged; rejects with an `AttachError` code as the message.
   */
  attach(file: Blob, options?: AttachOptions): Promise<AttachResult> {
    return sdk.dispatch('attach', file, options) as Promise<AttachResult>
  },
  showLauncher(): void {
    sdk.dispatch('showLauncher')
  },
  hideLauncher(): void {
    sdk.dispatch('hideLauncher')
  },
  // State queries — synchronous reads of internal state.
  isOpen(): boolean {
    return sdk.isOpen()
  },
  getUser(): WidgetUser | null {
    return sdk.getUser()
  },
  isIdentified(): boolean {
    return sdk.isIdentified()
  },
  on<T extends EventName>(name: T, handler: EventHandler<T>): Unsubscribe {
    return sdk.dispatch('on', name, handler) as Unsubscribe
  },
  off<T extends EventName>(name: T, handler?: EventHandler<T>): void {
    sdk.dispatch('off', name, handler)
  },
  metadata(patch: Record<string, string | null>): void {
    sdk.dispatch('metadata', patch)
  },
  /** Allow or stop host-page visitor analytics; `false` also removes the stored device id. */
  tracking(enabled: boolean): void {
    sdk.dispatch('tracking', enabled)
  },
  destroy(): void {
    sdk.dispatch('destroy')
  },
}

export default Quackback
