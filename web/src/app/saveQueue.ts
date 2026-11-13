/**
 * Runs one file save at a time. A save asked for while another is running is
 * queued (once per file) and runs right after it, so "Conservar el mío" or a
 * manual save during an autosave is never dropped in silence.
 */
export class SaveQueue {
  private busy = false;
  private waiting = new Map<string, () => Promise<void>>();

  constructor(
    private onWaiting: (paths: readonly string[]) => void = () => {},
  ) {}

  /** Save `path` now, or after the save that is running. */
  async request(path: string, save: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.waiting.set(path, save);
      this.onWaiting([...this.waiting.keys()]);
      return;
    }
    this.busy = true;
    try {
      await save();
    } finally {
      this.busy = false;
      const next = this.waiting.entries().next();
      if (!next.done) {
        const [nextPath, nextSave] = next.value;
        this.waiting.delete(nextPath);
        this.onWaiting([...this.waiting.keys()]);
        void this.request(nextPath, nextSave);
      }
    }
  }
}
