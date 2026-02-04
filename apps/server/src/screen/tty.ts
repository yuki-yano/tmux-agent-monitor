const TTY_PATH_PATTERN = /^\/dev\/(ttys?\d+|pts\/\d+)$/;

export const normalizeTty = (tty: string) => (tty.startsWith("/dev/") ? tty : `/dev/${tty}`);

export const isValidTty = (tty: string) => TTY_PATH_PATTERN.test(normalizeTty(tty));
