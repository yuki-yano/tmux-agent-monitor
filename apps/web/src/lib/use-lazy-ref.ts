import { type MutableRefObject, useState } from "react";

export const useLazyRef = <T>(factory: () => T): MutableRefObject<T> => {
  const [ref] = useState<MutableRefObject<T>>(() => ({ current: factory() }));
  return ref;
};
