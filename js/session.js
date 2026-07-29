import { db } from './db.js';

const SHELL_PREFERENCE_KEY = 'shell';
const REFERENCE_CACHE_MS = 300000;
let activeContext = null;

function basePath() {
  const path = globalThis.location.pathname;
  const appIndex = path.indexOf('/app/');
  if (appIndex >= 0) return path.slice(0, appIndex + 1);
  return path.slice(0, path.lastIndexOf('/') + 1);
}

function appUrl(path) {
  return `${basePath()}${String(path).replace(/^\//, '')}`;
}

function currentReturnPath() {
  return `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
}

function isSafeReturn(value) {
  if (!value) return false;
  try {
    const url = new URL(value, globalThis.location.origin);
    return url.origin === globalThis.location.origin && url.pathname.startsWith(basePath());
  } catch {
    return false;
  }
}

async function loadProfile(userId) {
  return db.select('profiles', query => query
    .select('id, username, full_name, contact_email, role_code, is_active, must_change_password, organization_name, external_party_type')
    .eq('id', userId)
    .single(), {
    key: `profile:${userId}`,
    cache: REFERENCE_CACHE_MS,
    retry: 1,
    userMessage: 'Your MaxDock profile could not be loaded.',
  });
}

async function loadRole(roleCode) {
  return db.select('roles', query => query
    .select('code, name, rank')
    .eq('code', roleCode)
    .eq('is_active', true)
    .single(), {
    key: `role:${roleCode}`,
    cache: REFERENCE_CACHE_MS,
    retry: 1,
    userMessage: 'Your MaxDock role could not be loaded.',
  });
}

async function loadPermissions(roleCode) {
  const rows = await db.select('role_permissions', query => query
    .select('permission_code')
    .eq('role_code', roleCode), {
    key: `permissions:${roleCode}`,
    cache: REFERENCE_CACHE_MS,
    retry: 1,
    userMessage: 'Your MaxDock permissions could not be loaded.',
  });
  return new Set((rows || []).map(row => row.permission_code));
}

async function loadLocations() {
  return db.select('locations', query => query
    .select('id, code, name, timezone, is_active')
    .eq('is_active', true)
    .order('name'), {
    key: 'locations:accessible',
    cache: REFERENCE_CACHE_MS,
    retry: 1,
    userMessage: 'Your accessible MaxDock locations could not be loaded.',
  });
}

async function loadPreference() {
  return db.rpc('get_user_preference', { p_preference_key: SHELL_PREFERENCE_KEY }, {
    key: 'preference:shell',
    cache: 30000,
    retry: 1,
    userMessage: 'Your saved MaxDock display settings could not be loaded.',
  });
}

function resolveLocation(locations, preference) {
  if (!locations.length) return null;
  const requested = new URLSearchParams(globalThis.location.search).get('location');
  const preferred = preference?.location_id;
  return locations.find(location => location.id === requested)
    || locations.find(location => location.id === preferred)
    || locations[0];
}

function buildContext(authSession, profile, role, permissions, locations, preference) {
  const location = resolveLocation(locations, preference);
  const context = {
    authSession,
    user: authSession.user,
    profile,
    role,
    permissions,
    locations,
    location,
    preference: preference || {},
  };
  context.can = permission => permissions.has(permission);
  context.hasLocation = locationId => locations.some(item => item.id === locationId);
  context.customerShell = context.can('appointment.view_own')
    && !context.can('dock.view')
    && !context.can('operations.queue.view')
    && !context.can('reports.view');
  return context;
}

export const session = Object.freeze({
  async getAuthSession() {
    return db.auth.getSession();
  },

  async loadContext(options = {}) {
    const authSession = await db.auth.getSession();
    if (!authSession) {
      if (options.redirect !== false) this.redirectToLogin();
      return null;
    }

    const [profile, preference] = await Promise.all([
      loadProfile(authSession.user.id),
      loadPreference(),
    ]);

    if (!profile?.is_active) {
      throw {
        code: 'MAXDOCK_ACCOUNT_INACTIVE',
        userMessage: 'This MaxDock account is inactive. Contact a MaxDock administrator.',
      };
    }

    if (profile.must_change_password && options.allowPasswordSetup !== true) {
      const returnPath = encodeURIComponent(currentReturnPath());
      globalThis.location.replace(`${appUrl('index.html')}?mode=setup&return=${returnPath}`);
      return null;
    }

    const [role, permissions, locations] = await Promise.all([
      loadRole(profile.role_code),
      loadPermissions(profile.role_code),
      loadLocations(),
    ]);

    activeContext = buildContext(authSession, profile, role, permissions, locations || [], preference);
    return activeContext;
  },

  context() {
    return activeContext;
  },

  can(permission) {
    return Boolean(activeContext?.permissions?.has(permission));
  },

  hasLocation(locationId) {
    return Boolean(activeContext?.locations?.some(location => location.id === locationId));
  },

  defaultPath(context = activeContext) {
    if (context?.can('dock.view')) return appUrl('app/board.html');
    return appUrl('app/my-appointments.html');
  },

  safeReturn(value, fallbackContext = activeContext) {
    return isSafeReturn(value) ? value : this.defaultPath(fallbackContext);
  },

  redirectToLogin() {
    const returnPath = encodeURIComponent(currentReturnPath());
    globalThis.location.replace(`${appUrl('index.html')}?return=${returnPath}`);
  },

  async saveShellPreference(changes) {
    const current = activeContext?.preference || {};
    const preference = { ...current, ...changes };
    await db.rpc('save_user_preference', {
      p_preference_key: SHELL_PREFERENCE_KEY,
      p_preferences: preference,
    }, {
      key: 'preference:shell:save',
      retry: 1,
      userMessage: 'Your MaxDock display setting could not be saved.',
    });
    db.invalidate('preference:shell');
    if (activeContext) activeContext.preference = preference;
    return preference;
  },

  async chooseLocation(locationId) {
    if (!this.hasLocation(locationId)) {
      throw { code: 'MAXDOCK_LOCATION_DENIED', userMessage: 'You do not have access to that location.' };
    }
    await this.saveShellPreference({ location_id: locationId });
    const url = new URL(globalThis.location.href);
    url.searchParams.set('location', locationId);
    globalThis.location.assign(url.href);
  },

  async setTextSize(value) {
    const allowed = new Set(['normal', 'large', 'larger']);
    const textSize = allowed.has(value) ? value : 'normal';
    document.documentElement.dataset.text = textSize;
    // Anything sized by measurement rather than by CSS has to be told: the dock
    // board decides how many lines fit in a block by measuring it, and a bigger
    // type scale changes that answer without changing a single box.
    document.dispatchEvent(new CustomEvent('maxdock:text-size', { detail: { textSize } }));
    await this.saveShellPreference({ text_size: textSize });
    return textSize;
  },

  // The sidebar collapsed to its icons and back, the way every application with a
  // rail this size works. It is remembered per account rather than per browser,
  // so a supervisor who works narrow gets the narrow rail at whichever station
  // they sign in at. Below 900px the rail is icons regardless — there the choice
  // is not the user's to make, it is the screen's.
  async setRail(value) {
    const rail = value === 'mini' ? 'mini' : 'full';
    document.documentElement.dataset.rail = rail;
    // The board measures how many lines fit in a block, and the rail's width is
    // the board's width — the same reason a text-size change has to be announced.
    document.dispatchEvent(new CustomEvent('maxdock:text-size', { detail: { rail } }));
    await this.saveShellPreference({ rail });
    return rail;
  },

  async signOut() {
    activeContext = null;
    db.invalidate();
    await db.auth.signOut();
    globalThis.location.replace(appUrl('index.html'));
  },

  onAuthChange(callback) {
    return db.auth.onChange(callback);
  },
});
