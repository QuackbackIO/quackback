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

// A server module run on a worker thread: the URL to hand `new Worker()`
// (src/lib/build/server-workers.ts).
declare module '*?server-worker' {
  const url: URL
  export default url
}
