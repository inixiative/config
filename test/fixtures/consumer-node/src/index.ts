export const add = (a: number, b: number): number => a + b;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
