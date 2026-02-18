/// <reference types="vite/client" />

// Build-time constants injected by Vite define
declare const __APP_VERSION__: string
declare const __GIT_COMMIT__: string
declare const __BUILD_TIME__: string

// Support for importing SQL files as raw strings
declare module '*.sql?raw' {
  const content: string
  export default content
}
