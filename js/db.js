const SUPABASE_URL = 'https://rywzqepzramurbrpmept.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xZL-zqQP2qaQKGVBL1TGdA_62I9r1PA';

if (!globalThis.supabase?.createClient) {
  throw new Error('The Supabase client library did not load. Refresh the page and try again.');
}

const client = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const cache = new Map();
const inFlight = new Map();
let connectionState = 'online';

function emitConnection(state, detail = {}) {
  if (connectionState === state && state === 'online') return;
  connectionState = state;
  globalThis.dispatchEvent(new CustomEvent('maxdock:connection', { detail: { state, ...detail } }));
}

function normalizeError(error, fallbackMessage) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || 'MAXDOCK_REQUEST_FAILED');
  const raw = String(error?.message || fallbackMessage || 'The request could not be completed.');
  const retryable = !status || status >= 500 || code === 'PGRST000' || code === 'NETWORK_ERROR';
  const lower = raw.toLowerCase();
  let userMessage = fallbackMessage || 'MaxDock could not complete that request.';

  if (lower.includes('permission') || lower.includes('not allowed') || status === 401 || status === 403) {
    userMessage = 'Your account does not have permission to complete this action.';
  } else if (lower.includes('inactive')) {
    userMessage = 'This MaxDock account is inactive. Contact a MaxDock administrator.';
  } else if (lower.includes('network') || lower.includes('fetch') || status >= 500) {
    userMessage = 'The connection was interrupted. MaxDock will keep trying.';
  } else if (raw && raw.length < 180) {
    userMessage = raw;
  }

  return { code, message: raw, retryable, userMessage, status, cause: error };
}

function wait(milliseconds) {
  return new Promise(resolve => globalThis.setTimeout(resolve, milliseconds));
}

async function execute(key, operation, options = {}) {
  const cacheMs = Math.max(0, Number(options.cache || 0));
  const retry = Math.max(0, Number(options.retry ?? 1));
  const cached = cache.get(key);
  const now = performance.now();

  if (cacheMs && cached && cached.expires > now) return cached.data;
  if (inFlight.has(key)) return inFlight.get(key);

  const request = (async () => {
    let attempt = 0;
    while (true) {
      try {
        const result = await operation();
        if (result?.error) throw result.error;
        const data = result?.data ?? null;
        if (cacheMs) cache.set(key, { data, expires: performance.now() + cacheMs });
        emitConnection('online');
        return data;
      } catch (cause) {
        const error = normalizeError(cause, options.userMessage);
        if (!error.retryable || attempt >= retry) {
          emitConnection('offline', { error });
          throw error;
        }
        attempt += 1;
        await wait(Math.min(4000, 400 * (2 ** (attempt - 1))));
      }
    }
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

function stableKey(prefix, value) {
  return `${prefix}:${JSON.stringify(value ?? {})}`;
}

export const db = Object.freeze({
  async rpc(name, args = {}, options = {}) {
    const key = options.key || stableKey(`rpc:${name}`, args);
    return execute(key, () => client.rpc(name, args), options);
  },

  async select(table, buildQuery, options = {}) {
    const key = options.key || stableKey(`select:${table}`, options.cacheKey || {});
    return execute(key, () => {
      const base = client.from(table);
      return buildQuery(base);
    }, options);
  },

  async edge(functionName, body, options = {}) {
    const key = options.key || stableKey(`edge:${functionName}`, body);
    return execute(key, () => client.functions.invoke(functionName, { body }), options);
  },

  invalidate(prefix = '') {
    for (const key of cache.keys()) {
      if (!prefix || key.startsWith(prefix)) cache.delete(key);
    }
  },

  async recordUsage(eventType, pageCode, activeSeconds = 0) {
    try {
      await client.rpc('record_user_usage', {
        p_event_type: eventType,
        p_page_code: pageCode,
        p_active_seconds: activeSeconds,
      });
    } catch {
      // Usage telemetry must never interrupt the operational interface.
    }
  },

  auth: Object.freeze({
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw normalizeError(error, 'Your MaxDock session could not be restored.');
      return data.session;
    },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw normalizeError(error, 'The email or password is incorrect.');
      return data;
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw normalizeError(error, 'MaxDock could not sign you out.');
    },
    async requestPasswordReset(email, redirectTo) {
      const { data, error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw normalizeError(error, 'The password reset email could not be sent.');
      return data;
    },
    async updatePassword(password) {
      const { data, error } = await client.auth.updateUser({ password });
      if (error) throw normalizeError(error, 'The new password could not be saved.');
      return data;
    },
    onChange(callback) {
      const { data } = client.auth.onAuthStateChange(callback);
      return () => data.subscription.unsubscribe();
    },
  }),
});
