import { element } from './dom.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(tagName, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

export function createLineIcon(pathData, label = null) {
  const svg = svgElement('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
  });
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const path = svgElement('path', { d: pathData });
  svg.append(path);
  return svg;
}

export function createMoodIcon(value, options = {}) {
  const svg = svgElement('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
  });
  const label = options.label || null;
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }

  if (value === 1) {
    svg.append(
      svgElement('circle', {
        cx: 12,
        cy: 12,
        r: 10.4,
        fill: 'var(--cp-mood-1)',
      }),
      svgElement('path', {
        d: 'M8.3 10.2 10.4 11.9 8.3 13.6M15.7 10.2 13.6 11.9 15.7 13.6',
        stroke: 'var(--cp-face-contrast)',
        'stroke-width': 1.3,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
      svgElement('path', {
        d: 'M10.1 16.9h3.8',
        stroke: 'var(--cp-face-contrast)',
        'stroke-width': 1.3,
        'stroke-linecap': 'round',
      }),
    );
    return svg;
  }

  svg.style.color = `var(--cp-mood-${value})`;
  svg.append(
    svgElement('circle', {
      cx: 12,
      cy: 12,
      r: 9.4,
      stroke: 'currentColor',
      'stroke-width': 2.5,
    }),
  );

  if (value === 5) {
    svg.append(
      svgElement('path', {
        d: 'M8.1 11q1.3-1.7 2.6 0M13.3 11q1.3-1.7 2.6 0',
        stroke: 'currentColor',
        'stroke-width': 1.3,
        'stroke-linecap': 'round',
      }),
      svgElement('path', {
        d: 'M8.8 13.6q3.2 3.7 6.4 0',
        stroke: 'currentColor',
        'stroke-width': 1.3,
        'stroke-linecap': 'round',
      }),
    );
    return svg;
  }

  svg.append(
    svgElement('circle', { cx: 9.4, cy: 10.6, r: 1.37, fill: 'currentColor' }),
    svgElement('circle', { cx: 14.6, cy: 10.6, r: 1.37, fill: 'currentColor' }),
  );
  const mouthByValue = {
    2: 'M9.2 15.5q2.8-2.7 5.6 0',
    3: 'M9.6 15.2h4.8',
    4: 'M9.2 13.8q2.8 2.7 5.6 0',
  };
  svg.append(
    svgElement('path', {
      d: mouthByValue[value],
      stroke: 'currentColor',
      'stroke-width': 1.3,
      'stroke-linecap': 'round',
    }),
  );
  return svg;
}

export const NAV_ICONS = Object.freeze({
  timeline: () =>
    createLineIcon('M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01'),
  calendar: () =>
    createLineIcon('M5 4.5h14a2 2 0 0 1 2 2V20H3V6.5a2 2 0 0 1 2-2ZM7 2v5M17 2v5M3 9h18'),
  statistics: () => createLineIcon('M4 19V9M10 19V4M16 19v-7M22 19V7'),
  settings: () =>
    createLineIcon(
      'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm7.4 5 2-1.5-2.4-4.2-2.3.9a7 7 0 0 0-1.5-.8L14.8 5H9.2l-.4 2.9q-.8.3-1.5.8L5 7.8 2.6 12l2 1.5a7 7 0 0 0 0 1L2.6 16 5 20.2l2.3-.9q.7.5 1.5.8l.4 2.9h5.6l.4-2.9q.8-.3 1.5-.8l2.3.9 2.4-4.2-2-1.5a7 7 0 0 0 0-1Z',
    ),
});

export function createStarText(favorite) {
  return element('span', {
    text: favorite ? '★' : '☆',
    attributes: { 'aria-hidden': 'true' },
  });
}
