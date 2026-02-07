const COMPRESSED_MASK = 1n << 63n;

const toSafeNumber = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("value exceeds Number.MAX_SAFE_INTEGER");
  }
  return Number(value);
};

export const encodeLeb128Unsigned = (value: number | bigint): Buffer => {
  let remaining = typeof value === "bigint" ? value : BigInt(value);
  if (remaining < 0n) {
    throw new Error("value must be unsigned");
  }
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining !== 0n);
  return Buffer.from(bytes);
};

export const decodeLeb128Unsigned = (
  buffer: Buffer,
  offset = 0,
): { value: bigint; nextOffset: number } | null => {
  let result = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = BigInt(buffer[cursor] ?? 0);
    result |= (byte & 0x7fn) << shift;
    cursor += 1;
    if ((byte & 0x80n) === 0n) {
      return { value: result, nextOffset: cursor };
    }
    shift += 7n;
    if (shift > 70n) {
      throw new Error("invalid leb128 value");
    }
  }
  return null;
};

const encodeVarU16 = (value: number) => encodeLeb128Unsigned(value);
const encodeVarU32 = (value: number) => encodeLeb128Unsigned(value);
const encodeVarU64 = (value: number) => encodeLeb128Unsigned(value);

const enumVariantIndices = {
  Char: 0,
  Backspace: 5,
  Tab: 6,
  Enter: 8,
  Escape: 10,
  PageUp: 24,
  PageDown: 25,
  End: 26,
  Home: 27,
  LeftArrow: 28,
  RightArrow: 29,
  UpArrow: 30,
  DownArrow: 31,
  Function: 59,
} as const;

type ProxyKeyCode =
  | { kind: "char"; value: string }
  | {
      kind: "named";
      value:
        | "Backspace"
        | "Tab"
        | "Enter"
        | "Escape"
        | "PageUp"
        | "PageDown"
        | "End"
        | "Home"
        | "LeftArrow"
        | "RightArrow"
        | "UpArrow"
        | "DownArrow";
    }
  | { kind: "function"; value: number };

export type ProxyKeyEvent = {
  key: ProxyKeyCode;
  modifiers: number;
};

const encodeProxyKeyCode = (key: ProxyKeyCode): Buffer => {
  if (key.kind === "char") {
    const codePoint = key.value.codePointAt(0);
    if (codePoint == null) {
      throw new Error("invalid char key");
    }
    return Buffer.concat([encodeVarU32(enumVariantIndices.Char), encodeVarU32(codePoint)]);
  }
  if (key.kind === "named") {
    const index = enumVariantIndices[key.value];
    return encodeVarU32(index);
  }
  if (!Number.isInteger(key.value) || key.value < 1 || key.value > 24) {
    throw new Error("function key must be between F1 and F24");
  }
  return Buffer.concat([encodeVarU32(enumVariantIndices.Function), Buffer.from([key.value])]);
};

export const encodeSendKeyDownPayload = ({
  paneId,
  event,
  inputSerialMs,
}: {
  paneId: number;
  event: ProxyKeyEvent;
  inputSerialMs: number;
}): Buffer => {
  if (!Number.isInteger(paneId) || paneId < 0) {
    throw new Error("paneId must be a non-negative integer");
  }
  if (!Number.isInteger(event.modifiers) || event.modifiers < 0 || event.modifiers > 0xffff) {
    throw new Error("modifiers must be between 0 and 65535");
  }
  if (!Number.isInteger(inputSerialMs) || inputSerialMs < 0) {
    throw new Error("inputSerialMs must be a non-negative integer");
  }

  return Buffer.concat([
    encodeVarU64(paneId),
    encodeProxyKeyCode(event.key),
    encodeVarU16(event.modifiers),
    encodeVarU64(inputSerialMs),
  ]);
};

export const encodePduFrame = ({
  ident,
  serial,
  data,
}: {
  ident: number;
  serial: number;
  data: Buffer;
}): Buffer => {
  const serialPart = encodeLeb128Unsigned(serial);
  const identPart = encodeLeb128Unsigned(ident);
  const len = BigInt(serialPart.length + identPart.length + data.length);
  const lenPart = encodeLeb128Unsigned(len);
  return Buffer.concat([lenPart, serialPart, identPart, data]);
};

export type DecodedPduFrame = {
  serial: number;
  ident: number;
  data: Buffer;
  bytesConsumed: number;
};

export const decodeNextPduFrame = (buffer: Buffer): DecodedPduFrame | null => {
  const lenPart = decodeLeb128Unsigned(buffer, 0);
  if (!lenPart) {
    return null;
  }
  if ((lenPart.value & COMPRESSED_MASK) !== 0n) {
    throw new Error("compressed pdu is not supported");
  }
  const len = toSafeNumber(lenPart.value);
  const serialPart = decodeLeb128Unsigned(buffer, lenPart.nextOffset);
  if (!serialPart) {
    return null;
  }
  const identPart = decodeLeb128Unsigned(buffer, serialPart.nextOffset);
  if (!identPart) {
    return null;
  }
  const headerLen =
    serialPart.nextOffset - lenPart.nextOffset + (identPart.nextOffset - serialPart.nextOffset);
  const payloadLen = len - headerLen;
  if (payloadLen < 0) {
    throw new Error("invalid pdu length");
  }
  const payloadStart = identPart.nextOffset;
  const payloadEnd = payloadStart + payloadLen;
  if (buffer.length < payloadEnd) {
    return null;
  }
  return {
    serial: toSafeNumber(serialPart.value),
    ident: toSafeNumber(identPart.value),
    data: buffer.subarray(payloadStart, payloadEnd),
    bytesConsumed: payloadEnd,
  };
};

export const decodeErrorResponseReason = (data: Buffer): string | null => {
  const lenPart = decodeLeb128Unsigned(data, 0);
  if (!lenPart) {
    return null;
  }
  const size = toSafeNumber(lenPart.value);
  const start = lenPart.nextOffset;
  const end = start + size;
  if (data.length < end) {
    return null;
  }
  return data.subarray(start, end).toString("utf8");
};

export const encodeErrorResponseReason = (reason: string): Buffer => {
  const reasonBytes = Buffer.from(reason, "utf8");
  return Buffer.concat([encodeLeb128Unsigned(reasonBytes.length), reasonBytes]);
};
