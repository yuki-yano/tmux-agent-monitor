export const INPUT_TYPE_INSERT_TEXT = "insertText";
export const INPUT_TYPE_INSERT_FROM_PASTE = "insertFromPaste";
export const INPUT_TYPE_INSERT_LINE_BREAK = "insertLineBreak";
export const INPUT_TYPE_INSERT_PARAGRAPH = "insertParagraph";
export const INPUT_TYPE_DELETE_BACKWARD = "deleteContentBackward";
export const INPUT_TYPE_INSERT_COMPOSITION = "insertCompositionText";
export const INPUT_TYPE_INSERT_REPLACEMENT = "insertReplacementText";

const handleWithoutDataTypes = new Set<string>([
  INPUT_TYPE_INSERT_LINE_BREAK,
  INPUT_TYPE_INSERT_PARAGRAPH,
  INPUT_TYPE_DELETE_BACKWARD,
]);

const textInputTypes = new Set<string>([
  INPUT_TYPE_INSERT_TEXT,
  INPUT_TYPE_INSERT_FROM_PASTE,
  INPUT_TYPE_INSERT_REPLACEMENT,
  INPUT_TYPE_INSERT_COMPOSITION,
]);

type ResolveRawBeforeInputArgs = {
  rawMode: boolean;
  suppressNextBeforeInput: boolean;
  isComposing: boolean;
  inputType: string | null;
  data: string | null;
};

type ResolveRawBeforeInputResult =
  | { kind: "ignored" }
  | { kind: "consumeSuppressFlag" }
  | { kind: "handle"; inputType: string; data: string | null };

const isDisabledRawInput = ({ rawMode }: { rawMode: boolean }) => !rawMode;

const shouldIgnoreCompositionInput = ({
  isComposing,
  inputType,
}: {
  isComposing: boolean;
  inputType: string;
}) => isComposing && inputType === INPUT_TYPE_INSERT_COMPOSITION;

const canHandleBeforeInput = ({ inputType, data }: { inputType: string; data: string | null }) => {
  if (handleWithoutDataTypes.has(inputType)) {
    return true;
  }
  if (!textInputTypes.has(inputType)) {
    return false;
  }
  return Boolean(data);
};

export const resolveRawBeforeInput = ({
  rawMode,
  suppressNextBeforeInput,
  isComposing,
  inputType,
  data,
}: ResolveRawBeforeInputArgs): ResolveRawBeforeInputResult => {
  if (!inputType || isDisabledRawInput({ rawMode })) {
    return { kind: "ignored" };
  }
  if (suppressNextBeforeInput) {
    return { kind: "consumeSuppressFlag" };
  }
  if (shouldIgnoreCompositionInput({ isComposing, inputType })) {
    return { kind: "ignored" };
  }
  if (!canHandleBeforeInput({ inputType, data })) {
    return { kind: "ignored" };
  }
  return { kind: "handle", inputType, data };
};
