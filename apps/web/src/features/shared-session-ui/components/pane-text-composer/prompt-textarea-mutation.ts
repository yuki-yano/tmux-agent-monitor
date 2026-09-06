export const runPromptTextareaMutation = (
  mutate: () => void | Promise<void>,
  synchronize: () => void,
  fileInput?: HTMLInputElement,
) => {
  const result = mutate();
  return Promise.resolve(result).finally(() => {
    if (fileInput != null) {
      fileInput.value = "";
    }
    synchronize();
  });
};
