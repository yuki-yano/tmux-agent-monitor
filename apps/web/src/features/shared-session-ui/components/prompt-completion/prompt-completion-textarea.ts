import type { PromptCompletionOption } from "./prompt-completion-options";
import {
  type PromptCompletionToken,
  type PromptCompletionTokenTrigger,
  quotePromptFilePath,
} from "./prompt-completion-token";

export const replacePromptCompletionToken = (
  textarea: HTMLTextAreaElement,
  token: PromptCompletionToken,
  option: PromptCompletionOption,
) => {
  const rawInsert =
    option.kind === "file" ? quotePromptFilePath(option.insertText) : option.insertText;
  const nextCharacter = textarea.value[token.end] ?? "";
  const insertText = nextCharacter && /\s/.test(nextCharacter) ? rawInsert : `${rawInsert} `;
  textarea.setRangeText(insertText, token.start, token.end, "end");
};

export const insertPromptCompletionTrigger = (
  textarea: HTMLTextAreaElement,
  trigger: PromptCompletionTokenTrigger,
) => {
  const sigil = trigger === "dollar" ? "$" : trigger === "at" ? "@" : "/";
  const start = textarea.selectionStart;
  const prefix = start > 0 && !/\s/.test(textarea.value[start - 1] ?? "") ? " " : "";
  textarea.setRangeText(`${prefix}${sigil}`, start, textarea.selectionEnd, "end");
};
