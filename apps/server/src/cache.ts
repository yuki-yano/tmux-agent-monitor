export const setMapEntryWithLimit = <K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
) => {
  if (maxEntries < 1) {
    map.clear();
    return;
  }
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey == null) {
      break;
    }
    map.delete(oldestKey);
  }
};
