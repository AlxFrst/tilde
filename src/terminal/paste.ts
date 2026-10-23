/**
 * Pasting several lines into a shell runs each of them. Ask first, unless the program
 * enabled bracketed paste (it then receives the text as one block). A single trailing
 * newline is a normal "paste and run" and is not asked about.
 */
export function needsPasteConfirmation(text: string, bracketedPasteMode: boolean): boolean {
  if (bracketedPasteMode) return false;
  return /\r?\n/.test(text.replace(/\r?\n$/, ''));
}

/** Number of lines a paste would run, for the confirmation message. */
export function pastedLineCount(text: string): number {
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length;
}
