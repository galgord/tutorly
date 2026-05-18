/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// `@fontsource-variable/*` packages auto-inject `@font-face` declarations as
// a side-effect import; they ship no TypeScript surface, so we declare the
// modules as side-effect-only.
declare module '@fontsource-variable/heebo';
declare module '@fontsource-variable/rubik';

// jsdom is dev-only (used by vitest's environment + a couple of unit tests).
// We don't need its full surface — just enough to construct a JSDOM.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, opts?: { url?: string; runScripts?: string });
    window: Window & typeof globalThis;
  }
}
