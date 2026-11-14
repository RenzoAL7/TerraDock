/** How long a line may wait for the text that adds it. */
export const REVEAL_WAIT_MS = 5_000;

/**
 * A line to reveal in the editor. It can be asked for before the update that
 * adds it reaches the model (a resource created from the diagram, revealed
 * while its text is still on its way): then it waits for a later sync, for a
 * few seconds at most, so a line that never arrives cannot move the view
 * while the user types much later.
 */
export class PendingReveal {
  private line = 0;
  private since = 0;

  /** Ask to reveal `line`; returns it if the model has it, 0 to wait. */
  request(line: number, lineCount: number, now = Date.now()) {
    this.line = line > 0 ? line : 0;
    this.since = now;
    return this.take(lineCount, now);
  }

  /** After the model changed: the waiting line, once it exists, or 0. */
  take(lineCount: number, now = Date.now()) {
    if (this.line === 0) return 0;
    if (now - this.since > REVEAL_WAIT_MS) {
      this.line = 0;
      return 0;
    }
    if (this.line > lineCount) return 0;
    const line = this.line;
    this.line = 0;
    return line;
  }
}
