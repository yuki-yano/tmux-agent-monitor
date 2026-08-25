import { useState } from "react";

export const useJsxOnly = () => <div />;

export const useActualHook = () => useState(0);

export const Component = () => <div />;

export const optedInHelper = () => {
  "use memo";
  return 1;
};

export const factory = () => {
  const NestedComponent = () => <div />;
  return NestedComponent;
};
