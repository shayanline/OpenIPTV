// React otherwise chooses WebKit event names before the test modules are loaded.
if (typeof window.AnimationEvent !== "function") {
  window.AnimationEvent = class AnimationEvent extends window.Event {
    readonly animationName: string;
    readonly elapsedTime: number;
    readonly pseudoElement: string;

    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? "";
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? "";
    }
  };
}

globalThis.AnimationEvent = window.AnimationEvent;
