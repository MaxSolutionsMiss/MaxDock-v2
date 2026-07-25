import { startPage } from '../router.js';
import { mountComposedPage } from '../ui/composed.js';

const markup = `<div class="pagehead"><div><h1 class="pagehead__title">Reports</h1><p class="pagehead__sub">Pickering · last 30 days</p></div><div class="pagehead__actions"><button class="btn btn--quiet btn--sm" data-export="">Export CSV</button><button class="btn btn--quiet btn--sm" data-print="">Print</button></div></div><div class="controls"><div class="ctrl-field"><label>View</label><select class="select"><option>Dock utilisation</option><option>Truck flow</option><option>Skid movement</option></select></div><div class="ctrl-field"><label>From</label><input class="input input--date" type="date" value="2026-06-25"></div><div class="ctrl-field"><label>To</label><input class="input input--date" type="date" value="2026-07-25"></div><div class="controls__end"><button class="btn btn--primary btn--sm" data-apply="">Apply</button></div></div><div class="kpis kpis--5"><div class="kpi"><span class="kpi__label">Appointments</span><span class="kpi__value">184</span></div><div class="kpi kpi--out"><span class="kpi__label">Inbound skids</span><span class="kpi__value">1.2k</span></div><div class="kpi kpi--ok"><span class="kpi__label">Outbound skids</span><span class="kpi__value">2.0k</span></div><div class="kpi kpi--stop"><span class="kpi__label">Cancel rate</span><span class="kpi__value">7%</span></div><div class="kpi kpi--signal"><span class="kpi__label">Booked hours</span><span class="kpi__value">312</span></div></div><div class="panel panel--fill"><div class="panel__head"><h3 class="panel__title">Dock utilisation · daily</h3><div class="panel__actions"><span class="sub">Jun 25 – Jul 25</span></div></div><div><div class="chart"><div class="bar"></div><div class="bar"></div><div class="bar bar--alt"></div><div class="bar"></div><div class="bar"></div><div class="bar bar--alt"></div><div class="bar"></div></div><p class="hint">Blue = inbound, green = outbound. AI Operations Brief available — advisory only.</p></div></div>`;

const page = {
  code: 'reports',
  async mount(context) { mountComposedPage(context.pageRoot, markup, { code: 'reports', context }); },
  refresh() {},
  destroy() {},
};

startPage(page);
export const { mount, refresh, destroy } = page;
