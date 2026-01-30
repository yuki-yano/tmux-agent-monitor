export const isNearBottom = (
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 48,
) => {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= threshold;
};
