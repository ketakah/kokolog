import { button, element } from './dom.mjs';
import { NAV_ICONS } from './icons.mjs';

const TABS = [
  { route: 'timeline', label: 'タイムライン', path: '/timeline' },
  { route: 'calendar', label: 'カレンダー', path: '/calendar' },
  { route: 'statistics', label: '統計', path: '/statistics' },
  { route: 'settings', label: '設定', path: '/settings' },
];

export function createTopBar(options) {
  const left = options.left
    ? button(options.left.label, {
        className: 'top-bar-action',
        attributes: { 'aria-label': options.left.ariaLabel || options.left.label },
        on: { click: options.left.onClick },
      })
    : element('span');
  const title = options.onTitleClick
    ? button(options.title, {
        className: 'top-bar-title top-bar-title-button',
        attributes: {
          'aria-label': options.titleAriaLabel || options.title,
        },
        on: { click: options.onTitleClick },
      })
    : element('h1', { className: 'top-bar-title', text: options.title });
  const right = options.right
    ? button(options.right.label, {
        className: 'top-bar-action',
        attributes: {
          'aria-label': options.right.ariaLabel || options.right.label,
          ...(options.right.disabled ? { disabled: '' } : {}),
        },
        on: { click: options.right.onClick },
      })
    : element('span');

  return element('header', { className: 'top-bar' }, [left, title, right]);
}

export function scrollPageToTop(target = globalThis) {
  const reduceMotion = Boolean(
    target.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  const behavior = reduceMotion ? 'auto' : 'smooth';
  target.scrollTo({ top: 0, left: 0, behavior });
  return behavior;
}

export function createBottomTabs(activeRoute, navigate, options = {}) {
  const navigation = element('nav', {
    className: 'bottom-tabs',
    attributes: { 'aria-label': '主要画面' },
  });

  for (const tab of TABS) {
    const active = activeRoute === tab.route;
    const tabButton = button('', {
      className: 'tab-button',
      attributes: {
        'aria-label':
          active && options.activeLabel
            ? options.activeLabel
            : tab.label,
        ...(active ? { 'aria-current': 'page' } : {}),
      },
      on: {
        click: () => {
          if (active && options.onReselect) {
            options.onReselect(tab.route);
            return;
          }
          navigate(tab.path);
        },
      },
    });
    tabButton.append(
      NAV_ICONS[tab.route](),
      element('span', { text: tab.label }),
    );
    navigation.append(tabButton);
  }
  return navigation;
}

export function createScreen(options = {}) {
  return element('div', {
    className: `screen${options.withTabs ? ' screen-with-tabs' : ''}`,
  });
}
