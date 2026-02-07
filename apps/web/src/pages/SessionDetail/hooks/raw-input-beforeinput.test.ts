import { describe, expect, it } from "vitest";

import { resolveRawBeforeInput } from "./raw-input-beforeinput";

describe("resolveRawBeforeInput", () => {
  it("ignores when raw mode is disabled", () => {
    const result = resolveRawBeforeInput({
      rawMode: false,
      suppressNextBeforeInput: false,
      isComposing: false,
      inputType: "insertText",
      data: "a",
    });
    expect(result).toEqual({ kind: "ignored" });
  });

  it("consumes suppress-next-beforeinput flag", () => {
    const result = resolveRawBeforeInput({
      rawMode: true,
      suppressNextBeforeInput: true,
      isComposing: false,
      inputType: "insertText",
      data: "a",
    });
    expect(result).toEqual({ kind: "consumeSuppressFlag" });
  });

  it("ignores insertCompositionText while composing", () => {
    const result = resolveRawBeforeInput({
      rawMode: true,
      suppressNextBeforeInput: false,
      isComposing: true,
      inputType: "insertCompositionText",
      data: "あ",
    });
    expect(result).toEqual({ kind: "ignored" });
  });

  it("handles line-break input without data", () => {
    const result = resolveRawBeforeInput({
      rawMode: true,
      suppressNextBeforeInput: false,
      isComposing: false,
      inputType: "insertLineBreak",
      data: null,
    });
    expect(result).toEqual({
      kind: "handle",
      inputType: "insertLineBreak",
      data: null,
    });
  });

  it("handles text input with data", () => {
    const result = resolveRawBeforeInput({
      rawMode: true,
      suppressNextBeforeInput: false,
      isComposing: false,
      inputType: "insertText",
      data: "x",
    });
    expect(result).toEqual({
      kind: "handle",
      inputType: "insertText",
      data: "x",
    });
  });

  it("ignores text input without data", () => {
    const result = resolveRawBeforeInput({
      rawMode: true,
      suppressNextBeforeInput: false,
      isComposing: false,
      inputType: "insertReplacementText",
      data: "",
    });
    expect(result).toEqual({ kind: "ignored" });
  });
});
