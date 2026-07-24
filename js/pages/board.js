import { startPage } from '../router.js';
import { renderState } from '../ui/empty.js';

const page = {
  code: 'board',
  permission: 'dock.view',

  async mount(context) {
    document.title = `Dock board · ${context.location.name} · MaxDock`;
    const root = context.pageRoot;

    const head = document.createElement('div');
    head.className = 'page__head';
    const heading = document.createElement('div');
    const title = document.createElement('h1');
    title.className = 'page__title';
    title.textContent = 'Dock board';
    const subtitle = document.createElement('p');
    subtitle.className = 'page__sub';
    subtitle.textContent = `${context.location.name} · Stage 1 shell`;
    heading.append(title, subtitle);
    head.append(heading);

    const stateHost = document.createElement('div');
    renderState(stateHost, {
      type: 'empty',
      title: 'The application shell is ready',
      message: 'Authentication, permission-based navigation, location context, text size, connection handling and accessible empty states are active. Live dock-board data is added in Stage 4.',
    });

    root.append(head, stateHost);
  },

  async refresh() {},
  destroy() {},
};

startPage(page);

export const { mount, refresh, destroy } = page;
