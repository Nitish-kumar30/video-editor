import { describe, it, expect } from "vitest";
import { keepSegments, mergeCuts, outputDuration, sourceToOutput, skipCut } from "../lib/timeline";

describe("timeline", () => {
  it("merges overlapping and touching cuts", () => {
    expect(mergeCuts([{ start: 5, end: 8 }, { start: 1, end: 2 }, { start: 7, end: 9 }, { start: 9, end: 10 }], 20)).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 10 },
    ]);
  });

  it("computes keep segments and drops tiny ones", () => {
    const segs = keepSegments([{ start: 0.02, end: 3 }, { start: 5, end: 9.97 }], 10);
    expect(segs).toEqual([{ start: 3, end: 5 }]);
    expect(outputDuration(segs)).toBe(2);
  });

  it("returns no segments when everything is cut", () => {
    expect(keepSegments([{ start: 0, end: 10 }], 10)).toEqual([]);
  });

  it("maps source time to output time", () => {
    const segs = keepSegments([{ start: 2, end: 4 }], 10);
    expect(sourceToOutput(1, segs)).toBe(1);
    expect(sourceToOutput(3, segs)).toBeNull();
    expect(sourceToOutput(5, segs)).toBe(3);
  });

  it("skips cuts during playback", () => {
    expect(skipCut(2.5, [{ start: 2, end: 4 }], 10)).toBe(4);
    expect(skipCut(4.5, [{ start: 2, end: 4 }], 10)).toBeNull();
  });
});
