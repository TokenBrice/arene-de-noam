// Session-scoped cue bus (docs/battle-presentation.md §5). The director emits one cue per
// presented moment, on the fx-clock, never at engine-event time. Sound subscribes (3E), haptics
// later (4G). No module-level state: each battle session owns one bus and disposes it.

export const CUE_NAMES = Object.freeze([
  'windup',
  'release',
  'contact',
  'readout',
  'critical',
  'effective',
  'resisted',
  'miss',
  'blocked',
  'status+',
  'status-',
  'heal',
  'break',
  'ko',
  'faint-cry',
  'switch-out',
  'switch-in',
  'signature-ready',
  'signature-cutin',
  'victory',
  'defeat',
]);

const KNOWN = new Set(CUE_NAMES);
const ANY = '*';

function checkName(name, allowAny) {
  if (KNOWN.has(name) || (allowAny && name === ANY)) return;
  throw new TypeError(`Unknown battle cue: ${name}`);
}

export class CueBus {
  #handlers = new Map();
  #disposed = false;

  get disposed() {
    return this.#disposed;
  }

  // `handler(payload, name)`; `name` may be '*' for every cue. Returns an unsubscribe function.
  on(name, handler) {
    checkName(name, true);
    if (typeof handler !== 'function') throw new TypeError('Cue handler must be a function');
    if (this.#disposed) return () => {};
    let set = this.#handlers.get(name);
    if (!set) this.#handlers.set(name, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  // Delivers a shallow-frozen payload to the cue's handlers, then to '*' handlers. A throwing
  // subscriber is reported asynchronously and never stops the others or the director.
  emit(name, payload = {}) {
    checkName(name, false);
    if (this.#disposed) return 0;
    const frozen = Object.freeze({ ...payload }),
      handlers = [...(this.#handlers.get(name) || []), ...(this.#handlers.get(ANY) || [])];
    for (const handler of handlers)
      try {
        handler(frozen, name);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    return handlers.length;
  }

  dispose() {
    this.#disposed = true;
    this.#handlers.clear();
  }
}
