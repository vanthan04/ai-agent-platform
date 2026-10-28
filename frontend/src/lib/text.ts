/** The non-empty, trimmed lines of a text area, without repeats. */
export function lines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== ""))];
}
