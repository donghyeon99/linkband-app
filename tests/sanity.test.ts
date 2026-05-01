// Vitest 인프라 health check. parser 본격 테스트는 parser.test.ts.
import { describe, expect, it } from "vitest";

describe("sanity", () => {
  it("vitest is wired up", () => {
    expect(1 + 1).toBe(2);
  });
});
