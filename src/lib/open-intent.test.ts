import { describe, expect, it } from "vitest";
import { eventOpensInBackground } from "./open-intent";

describe("eventOpensInBackground", () => {
  it("uses modified primary clicks and middle clicks", () => {
    expect(eventOpensInBackground({ button: 0, ctrlKey: false, metaKey: true })).toBe(true);
    expect(eventOpensInBackground({ button: 0, ctrlKey: true, metaKey: false })).toBe(true);
    expect(eventOpensInBackground({ button: 1, ctrlKey: false, metaKey: false })).toBe(true);
  });

  it("ignores plain primary clicks and context-menu clicks", () => {
    expect(eventOpensInBackground({ button: 0, ctrlKey: false, metaKey: false })).toBe(false);
    expect(eventOpensInBackground({ button: 2, ctrlKey: true, metaKey: true })).toBe(false);
  });
});
