import { describe, expect, it } from "vitest";

import {
  decodeErrorResponseReason,
  decodeNextPduFrame,
  encodeErrorResponseReason,
  encodeLeb128Unsigned,
  encodePduFrame,
  encodeSendKeyDownPayload,
} from "./proxy-codec.js";

describe("proxy-codec", () => {
  it("encodes and decodes pdu frame", () => {
    const frame = encodePduFrame({
      ident: 11,
      serial: 7,
      data: Buffer.from([1, 2, 3]),
    });
    const decoded = decodeNextPduFrame(frame);

    expect(decoded).toEqual({
      ident: 11,
      serial: 7,
      data: Buffer.from([1, 2, 3]),
      bytesConsumed: frame.length,
    });
  });

  it("encodes SendKeyDown payload", () => {
    const payload = encodeSendKeyDownPayload({
      paneId: 12,
      event: {
        key: { kind: "named", value: "RightArrow" },
        modifiers: 8,
      },
      inputSerialMs: 1234,
    });

    expect(payload).toEqual(Buffer.from([0x0c, 0x1d, 0x08, 0xd2, 0x09]));
  });

  it("encodes frame with fixed bytes for regression safety", () => {
    const frame = encodePduFrame({
      ident: 11,
      serial: 7,
      data: Buffer.from([0x0c, 0x1d, 0x08, 0xd2, 0x09]),
    });
    expect(frame).toEqual(Buffer.from([0x07, 0x07, 0x0b, 0x0c, 0x1d, 0x08, 0xd2, 0x09]));
  });

  it("encodes and decodes ErrorResponse reason", () => {
    const data = encodeErrorResponseReason("pane 9 not found");
    expect(decodeErrorResponseReason(data)).toBe("pane 9 not found");
  });

  it("encodes unsigned leb128", () => {
    expect(encodeLeb128Unsigned(0)).toEqual(Buffer.from([0]));
    expect(encodeLeb128Unsigned(127)).toEqual(Buffer.from([127]));
    expect(encodeLeb128Unsigned(128)).toEqual(Buffer.from([128, 1]));
  });

  it("returns null for incomplete frame", () => {
    const frame = encodePduFrame({
      ident: 11,
      serial: 7,
      data: Buffer.from([1, 2, 3]),
    });
    expect(decodeNextPduFrame(frame.subarray(0, frame.length - 1))).toBeNull();
  });
});
