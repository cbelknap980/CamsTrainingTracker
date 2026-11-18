// icons.js - inline SVG icons (24px grid, stroke-based). Returns an SVG string; use with innerHTML or el().
const base = (paths, extra = '') => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths}</svg>`;

export const icons = {
  home: base('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/>'),
  history: base('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  progress: base('<path d="M4 4.5V19.5H20"/><path d="M7.5 15.5l4-5 3 2.5 4.5-6.5"/>'),
  runs: base('<path d="M4 19c3-6 6-7 9-5s5 1 7-3"/><circle cx="17.5" cy="6" r="1.6"/><path d="M4 14l2.5-4 3 2"/>'),
  architecture: base('<rect x="3" y="4" width="7" height="5" rx="1.2"/><rect x="14" y="4" width="7" height="5" rx="1.2"/><rect x="8.5" y="15" width="7" height="5" rx="1.2"/><path d="M6.5 9v3h11V9M12 12v3"/>'),
  settings: base('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  more: base('<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  check: base('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  skip: base('<path d="M6 5l9 7-9 7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>'),
  back: base('<path d="M18 5L9 12l9 7z" fill="currentColor" stroke="none"/><path d="M6 5v14"/>'),
  pause: base('<path d="M8 5v14M16 5v14" stroke-width="2.6"/>'),
  play: base('<path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" stroke="none"/>'),
  plus: base('<path d="M12 5v14M5 12h14"/>'),
  edit: base('<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/>'),
  stop: base('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'),
  scissors: base('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/>'),
  trophy: base('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v3M9 20h6M10 17h4v3h-4z"/>'),
  bell: base('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  list: base('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/>')
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = icons[name] || '';
  return span;
}
