export class Semaphore {
  #active = 0;
  constructor(limit) {
    this.limit = Math.max(1, limit);
  }

  tryAcquire() {
    if (this.#active >= this.limit) return false;
    this.#active += 1;
    return true;
  }

  release() {
    this.#active = Math.max(0, this.#active - 1);
  }

  get active() {
    return this.#active;
  }
}
