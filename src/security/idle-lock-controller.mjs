export class IdleLockController {
  constructor(options) {
    this.getDelay = options.getDelay;
    this.onLock = options.onLock;
    this.onError = options.onError || ((error) => console.error(error));
    this.setTimer = options.setTimer || globalThis.setTimeout.bind(globalThis);
    this.clearTimer =
      options.clearTimer || globalThis.clearTimeout.bind(globalThis);
    this.timer = null;
  }

  start() {
    return this.reset();
  }

  reset() {
    this.stop();
    const delay = Number(this.getDelay());
    if (!Number.isFinite(delay) || delay <= 0) {
      return false;
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      Promise.resolve(this.onLock()).catch(this.onError);
    }, delay);
    return true;
  }

  stop() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  isArmed() {
    return this.timer !== null;
  }
}
