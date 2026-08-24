import { describe, expect, it } from "vitest";

import {
  advanceFilesLookupGeneration,
  createFilesLookupController,
  rememberPositiveFilesLookup,
  resetFilesLookupController,
} from "./session-files-lookup-runtime";

describe("session files lookup runtime", () => {
  it("keeps positive entries across a connection generation and clears them on scope reset", () => {
    const controller = createFilesLookupController();
    rememberPositiveFilesLookup(controller, "existing", 2);

    advanceFilesLookupGeneration(controller);
    expect([...controller.positive.keys()]).toEqual(["existing"]);

    resetFilesLookupController(controller);
    expect(controller.positive.size).toBe(0);
  });

  it("evicts the oldest positive entry at the configured bound", () => {
    const controller = createFilesLookupController();
    rememberPositiveFilesLookup(controller, "first", 2);
    rememberPositiveFilesLookup(controller, "second", 2);
    rememberPositiveFilesLookup(controller, "third", 2);

    expect([...controller.positive.keys()]).toEqual(["second", "third"]);
  });
});
