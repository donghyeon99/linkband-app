/// <reference types="vitest" />
import { defineConfig } from "vite";

// Vite + Vitest 통합. 빌드 기본값(루트 정적 SPA), test pickup 기본 (`**/*.test.ts`).
// Vercel 배포 시 build output `dist/` 자동 인식.
export default defineConfig({
  test: {
    // node 환경 (DOM 필요한 테스트는 추후 jsdom 도입 검토). parser 는 순수 byte 변환이라 node 충분.
    environment: "node",
  },
});
