/** Compose className strings, filtering falsy values. Tiny, dep-free. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
