import {
  type CaptureOptions,
  captureTerminalScreen as captureTerminalScreenImpl,
} from "./screen/capture.js";

export const captureTerminalScreen = async (
  tty: string | null | undefined,
  options: CaptureOptions = {},
) => {
  return captureTerminalScreenImpl(tty, options);
};
