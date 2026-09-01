/**
 * Vitest setup. `@testing-library/jest-dom` adds the DOM matchers
 * (toBeInTheDocument, toBeDisabled, ...) and `cleanup` unmounts between
 * tests so one component's DOM cannot leak into the next assertion.
 *
 * Both are guarded: the suite runs in `environment: "node"` by default and
 * only component tests opt into jsdom, so importing DOM helpers
 * unconditionally would break every other file.
 */
import { afterEach } from "vitest";

if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());
}
