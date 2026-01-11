export const defer = (x) => {
  queueMicrotask(() => x());
};
