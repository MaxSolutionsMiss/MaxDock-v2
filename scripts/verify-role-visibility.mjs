#!/usr/bin/env node
// What each role sees: the rules that keep it a tidiness layer and not a lock.
//
// An administrator can take a link off a role's rail. That is a convenience, and
// the moment anybody treats it as security it becomes a hole, because a page whose
// permission the role holds still answers when its address is typed. So:
//
//   The permission is asked first and the visibility only ever subtracts. A role
//   cannot be *given* a page it has no permission for by ticking a box.
//
//   A System Admin's rail is not configurable, in the database and again in the
//   client. Hiding Settings from the only role that can put it back is how a
//   company locks itself out of its own administration.
//
//   A page's own permission check is untouched. Visibility never appears in
//   `pageAllowed`, because that is the gate that decides whether a screen may load
//   and it must stay a permission question.
//
//   One catalogue. The screen that arranges the rail reads the list the rail is
//   drawn from, or the two drift and the setting quietly stops offering a page.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const read = path => readFileSync(path, 'utf8');
const require_ = (text, pattern, message) => { if (!pattern.test(text)) errors.push(message); };

for (const file of ['js/router.js', 'js/session.js', 'js/pages/users.js', 'js/ui/role-access.js']) {
  if (!existsSync(file)) errors.push(`Missing ${file}`);
}

if (!errors.length) {
  const router = read('js/router.js');
  const session = read('js/session.js');
  const users = read('js/pages/users.js');
  const dialog = read('js/ui/role-access.js');
  const settings = read('js/pages/settings.js');

  // One catalogue, exported rather than copied.
  require_(router, /export const RAIL_PAGES/, 'The rail has no exported catalogue for the settings screen to read.');
  require_(router, /export function railPageAllowedByPermissions/, 'There is no way to ask whether a role is permitted a page, separately from whether it is hidden.');
  require_(users, /import \{ startPage, RAIL_PAGES, railPageAllowedByPermissions \}/, 'The users screen keeps its own list of rail pages instead of reading the rail\'s.');
  require_(dialog, /import \{ RAIL_PAGES, railPageAllowedByPermissions \}/, 'The role dialog keeps its own list of rail pages instead of reading the rail\'s.');

  // Permission first, visibility second, and only ever subtracting.
  require_(router, /function routeAllowed\(context, item\) \{\s*\n\s*if \(!hasRoutePermission\(context, item\)\) return false;/,
    'The rail must refuse a page on permission before it considers whether it is hidden.');
  require_(router, /context\.showsPage \? context\.showsPage\(item\.code\) : true/, 'The rail does not consult what the role is shown.');

  // The page gate stays a permission gate. If visibility ever reaches it, hiding a
  // page would start refusing an account that holds its permission — which reads as
  // security and is not.
  const pageAllowed = router.match(/function pageAllowed\(context, page\) \{[\s\S]*?\n\}/);
  if (!pageAllowed) errors.push('pageAllowed is gone — a page must still check its own permission.');
  else if (/showsPage|hiddenPages/.test(pageAllowed[0])) {
    errors.push('pageAllowed consults rail visibility. Hiding a link must never refuse a screen; only a permission may.');
  }

  // A System Admin always sees everything, in the client as well as the database.
  require_(session, /role_code === 'system_admin' \|\| !hiddenPages\.has\(pageCode\)/,
    'A System Admin\'s rail must be exempt from hiding, or a company can lock itself out of Settings.');
  // A System Admin's row is shown and never editable, and the dialog says why rather
  // than greying a control and leaving somebody guessing.
  require_(dialog, /readOnly = target\.code === 'system_admin'/, 'A System Admin must be read-only in the role dialog.');
  require_(dialog, /els\.save\.hidden = readOnly/, 'The save action must not be offered for a role that cannot be changed.');

  // Loaded with the shell, advisory, and cleared when it changes.
  require_(session, /list_role_page_visibility/, 'The shell never loads what this role is shown.');
  require_(session, /catch\(\(\) => \[\]\)/, 'Loading rail visibility must not be able to take the application down.');
  require_(dialog, /save_role_page_visibility/, 'The role dialog cannot save what each role sees.');
  // What a role may *do* is the real boundary, and it is the same window's job.
  require_(dialog, /save_role_permissions/, 'The role dialog cannot change what a role may do.');
  require_(dialog, /db\.invalidate\('navigation:visibility'\)/, 'Saving must clear the cached rail, or the person who changed it is the last to see it.');
  require_(dialog, /db\.invalidate\('permissions:'\)/, 'Saving permissions must clear the cached permission set.');
  // A screen cannot be shown for access the role does not hold, and unticking the
  // permission must take the screen with it rather than leaving an impossible pair.
  require_(dialog, /if \(!railPageAllowedByPermissions\(held, page\)\) hidden\.delete\(page\.code\)/,
    'Removing a permission must drop the screen that depended on it.');

  // Under Users, not Settings: Settings is where a site's operating rules live and a
  // role applies to every site. And on a page that is System Admin only already.
  require_(users, /\{ id: 'roles', label: 'Role access' \}/, 'Users has no Role access section.');
  require_(users, /role_code === 'system_admin'/, 'The page holding role access must be System Admin only.');
  if (/renderRoles|CONFIGURABLE_ROLES|save_role_page_visibility/.test(settings)) {
    errors.push('Settings still carries role access. It belongs under Users — a role applies to every site.');
  }

  // The rail must not offer a link whose page would refuse. Both of these carried no
  // permission at all until the visibility work went in.
  require_(router, /code: 'queue',[^}]*permission: 'operations\.queue\.view'/, 'The Operations queue rail item carries no permission.');
  require_(router, /code: 'reports',[^}]*permission: 'reports\.view'/, 'The Reports rail item carries no permission.');
}

if (errors.length) {
  console.error('Per-role rail visibility verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Per-role rail visibility verification passed');
