import { startPage } from '../router.js';
import { mountComposedPage } from '../ui/composed.js';

const markup = `<div class="pagehead"><div><h1 class="pagehead__title">Users</h1><p class="pagehead__sub">All locations · 24 people</p></div><div class="pagehead__actions"><button class="btn btn--primary" data-add-user=""><svg viewbox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></svg>Add user</button></div></div><div class="controls"><div class="ctrl-field"><label>Role</label><select class="select"><option>All roles</option></select></div><div class="ctrl-field"><label>Location</label><select class="select"><option>All locations</option></select></div><div class="controls__end"><input class="input" placeholder="Search name or email"></div></div><div class="panel panel--fill"><div class="panel__head"><h3 class="panel__title">People</h3><div class="panel__actions"><span class="sub">24 users</span></div></div><div class="panel__scroll"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Locations</th><th>Status</th><th></th></tr></thead><tbody><tr><td class="data--strong">Javad Resa</td><td class="data">javadresa@maxpkgsolutions.com</td><td><span class="tag tag--quiet">System Admin</span></td><td>All</td><td><span class="tag tag--ok">Active</span></td><td><button class="btn btn--quiet btn--sm">Edit</button></td></tr><tr><td class="data--strong">Maria Chen</td><td class="data">mchen@maxpkgsolutions.com</td><td><span class="tag tag--quiet">Shipping Mgr</span></td><td>Pickering</td><td><span class="tag tag--ok">Active</span></td><td><button class="btn btn--quiet btn--sm">Edit</button></td></tr><tr><td class="data--strong">Haleon Oakhill</td><td class="data">orders@haleon.com</td><td><span class="tag tag--quiet">Customer</span></td><td>Pickering, Guelph</td><td><span class="tag tag--ok">Active</span></td><td><button class="btn btn--quiet btn--sm">Edit</button></td></tr><tr><td class="data--strong">Sam Delgado</td><td class="data">sdelgado@maxpkgsolutions.com</td><td><span class="tag tag--quiet">Coordinator</span></td><td>Mississauga</td><td><span class="tag tag--quiet">Invited</span></td><td><button class="btn btn--quiet btn--sm">Edit</button></td></tr></tbody></table></div></div>`;

const page = {
  code: 'users',
  async mount(context) { mountComposedPage(context.pageRoot, markup, { code: 'users', context }); },
  refresh() {},
  destroy() {},
};

startPage(page);
export const { mount, refresh, destroy } = page;
