const ROUTE_PATTERNS = [
  {
    name: 'record-new',
    pattern: /^\/record\/new$/,
    parse: () => ({ name: 'record-new' }),
  },
  {
    name: 'record-edit',
    pattern: /^\/record\/([^/]+)\/edit$/,
    parse: (match) => ({ name: 'record-edit', id: decodeURIComponent(match[1]) }),
  },
  {
    name: 'record-history',
    pattern: /^\/record\/([^/]+)\/history$/,
    parse: (match) => ({ name: 'record-history', id: decodeURIComponent(match[1]) }),
  },
  {
    name: 'record-detail',
    pattern: /^\/record\/([^/]+)$/,
    parse: (match) => ({ name: 'record-detail', id: decodeURIComponent(match[1]) }),
  },
  {
    name: 'day',
    pattern: /^\/day\/(\d{4}-\d{2}-\d{2})$/,
    parse: (match) => ({ name: 'day', date: match[1] }),
  },
  {
    name: 'timeline',
    pattern: /^\/timeline$/,
    parse: () => ({ name: 'timeline' }),
  },
  {
    name: 'calendar',
    pattern: /^\/calendar$/,
    parse: () => ({ name: 'calendar' }),
  },
  {
    name: 'statistics',
    pattern: /^\/statistics$/,
    parse: () => ({ name: 'statistics' }),
  },
  {
    name: 'settings',
    pattern: /^\/settings$/,
    parse: () => ({ name: 'settings' }),
  },
  {
    name: 'settings-trash',
    pattern: /^\/settings\/trash$/,
    parse: () => ({ name: 'settings-trash' }),
  },
  {
    name: 'settings-pin',
    pattern: /^\/settings\/pin$/,
    parse: () => ({ name: 'settings-pin' }),
  },
  {
    name: 'settings-theme',
    pattern: /^\/settings\/theme$/,
    parse: () => ({ name: 'settings-theme' }),
  },
  {
    name: 'settings-storage',
    pattern: /^\/settings\/storage$/,
    parse: () => ({ name: 'settings-storage' }),
  },
  {
    name: 'settings-delete-all',
    pattern: /^\/settings\/delete-all$/,
    parse: () => ({ name: 'settings-delete-all' }),
  },
];

export function parseHash(hashValue = globalThis.location?.hash || '') {
  const withoutHash = hashValue.replace(/^#/, '');
  const [pathValue, queryString = ''] = withoutHash.split('?');
  const path = pathValue || '/timeline';

  for (const route of ROUTE_PATTERNS) {
    const match = route.pattern.exec(path);
    if (match) {
      return {
        ...route.parse(match),
        path,
        query: new URLSearchParams(queryString),
      };
    }
  }

  return {
    name: 'not-found',
    path,
    query: new URLSearchParams(queryString),
  };
}

export function createRouter(onRoute) {
  let started = false;

  const dispatch = () => onRoute(parseHash());
  const handleHashChange = () => dispatch();

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      globalThis.addEventListener('hashchange', handleHashChange);
      if (!globalThis.location.hash) {
        globalThis.location.replace('#/timeline');
        return;
      }
      dispatch();
    },
    stop() {
      if (!started) {
        return;
      }
      globalThis.removeEventListener('hashchange', handleHashChange);
      started = false;
    },
    navigate(path, options = {}) {
      const hash = `#${path}`;
      if (options.replace) {
        globalThis.location.replace(hash);
      } else {
        globalThis.location.hash = hash;
      }
    },
    back(fallback = '/timeline') {
      if (globalThis.history.length > 1) {
        globalThis.history.back();
      } else {
        this.navigate(fallback, { replace: true });
      }
    },
    refresh() {
      return dispatch();
    },
  };
}
