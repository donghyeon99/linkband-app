/// <reference types="vitest" />
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// `package.json` 의 version 을 빌드 시점에 `__APP_VERSION__` 으로 inject —
// 런타임에 import.meta.url 따라가지 않고 단일 source of truth 유지.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// Vite + Vitest 통합. 빌드 기본값(루트 정적 SPA), test pickup 기본 (`**/*.test.ts`).
// Vercel 배포 시 build output `dist/` 자동 인식.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    // node 환경 (DOM 필요한 테스트는 추후 jsdom 도입 검토). parser 는 순수 byte 변환이라 node 충분.
    environment: "node",
  },
});
