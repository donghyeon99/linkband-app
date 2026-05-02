/// <reference types="vite/client" />

/**
 * Build-time injected app version (from `package.json`, via `vite.config.ts`
 * `define`). Use directly in any module — TypeScript treats it as a literal
 * string after Vite substitutes it.
 */
declare const __APP_VERSION__: string;
