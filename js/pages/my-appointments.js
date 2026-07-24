import { startPage } from '../router.js';
import { renderState } from '../ui/empty.js';

const page = {
  code: 'my-appointments',
  permissions: ['appointment.view_own', 'appointment.view'],

  async mount(context) {
    document.title = 'My appointments · MaxDock';
    const root = context.pageRoot;

    const head = document.createElement('div');
    head.className = 'page__head';
    const heading = document.createElement('div');
    const title = document.createElement('h1');
    title.className = 'page__title';
    title.textContent = 'My appointments';
    const subtitle = document.createElement('p');
    subtitle.className = 'page__sub';
    subtitle.textContent = context.location ? context.location.name : 'Your appointment workspace';
    heading.append(title, subtitle);
    head.append(heading);

    const stateHost = document.createElement('div');
    renderState(stateHost, {
      type: 'empty',
      title: 'Appointments are connected in Stage 2',
      message: 'This customer-safe shell is active now. It contains no dock names, internal identifiers, other companies or operational administration fields.',
    });

    root.append(head, stateHost);
  },

  async refresh() {},
  destroy() {},
};

startPage(page);

export const { mount, refresh, destroy } = page;
