import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach the merger our custom font sizes, so text-figure and a text color class do not cancel each other.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['label', 'figure', 'title'] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
