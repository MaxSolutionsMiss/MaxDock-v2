const reasons = new Set();
let timer = null;
let config = null;
let stopped = true;
let failureCount = 0;

function nextDelay() {
  const backoff = [5000, 10000, 30000, 60000];
  if (!failureCount) return Number(config?.interval || 5000);
  return backoff[Math.min(failureCount - 1, backoff.length - 1)];
}

function schedule() {
  globalThis.clearTimeout(timer);
  if (stopped || !config) return;
  timer = globalThis.setTimeout(run, nextDelay());
}

async function run() {
  if (stopped || !config) return;
  if (reasons.size || document.visibilityState === 'hidden') {
    schedule();
    return;
  }

  try {
    const data = await config.fetch();
    await config.apply(data);
    if (failureCount) config.onFresh?.();
    failureCount = 0;
  } catch (error) {
    failureCount += 1;
    config.onStale?.(error, nextDelay());
  } finally {
    schedule();
  }
}

function handleVisibility() {
  if (document.visibilityState === 'hidden') {
    reasons.add('hidden-tab');
  } else {
    reasons.delete('hidden-tab');
    if (!stopped) run();
  }
}

document.addEventListener('visibilitychange', handleVisibility);

export const poll = Object.freeze({
  start(options) {
    this.stop();
    config = {
      interval: 5000,
      fetch: async () => null,
      apply: async () => {},
      ...options,
    };
    stopped = false;
    failureCount = 0;
    schedule();
  },

  suspend(reason = 'manual') {
    reasons.add(reason);
  },

  resume(reason = 'manual') {
    reasons.delete(reason);
    if (!stopped && !reasons.size) run();
  },

  isSuspended() {
    return reasons.size > 0;
  },

  stop() {
    stopped = true;
    config = null;
    failureCount = 0;
    reasons.clear();
    globalThis.clearTimeout(timer);
    timer = null;
  },
});
