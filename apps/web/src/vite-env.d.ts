/// <reference types="vite/client" />

// Support for importing SQL files as raw strings
declare module '*.sql?raw' {
  const content: string
  export default content
}
