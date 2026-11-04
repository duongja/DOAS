type IconName =
  | 'target'
  | 'plus'
  | 'arrow-right'
  | 'clock'
  | 'bolt'
  | 'wall'
  | 'flame'
  | 'compass'
  | 'alert'
  | 'abort'
  | 'check'
  | 'folder';

const PATHS: Record<IconName, string> = {
  target:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/><path d="M12 1.8v4.4M12 17.8v4.4M1.8 12h4.4M17.8 12h4.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'arrow-right': '<path d="M4 12h15M13 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7v5.4l3.4 2"/>',
  bolt: '<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12Z"/>',
  wall: '<path d="M3 6.5h18M3 12h18M3 17.5h18M7.5 3v18M16.5 3v18"/>',
  flame:
    '<path d="M12 2.5c.4 4-3.4 5.3-3.4 8.2 0 1.3.8 2.3 2 2.6-.2-2.2 1.2-3.6 2.3-4.4.2 2.5 3 3.2 3 6.2a4 4 0 0 1-8 0c0-1.3.5-2.4 1.3-3.3"/><path d="M12 21.5c3.9 0 6.6-2.4 6.6-6.2 0-2.2-1-4.1-2.4-5.7"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
  alert:
    '<path d="M10.3 3.6 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5"/><path d="M12 17h.01"/>',
  abort:
    '<path d="M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2Z"/><path d="m9 9 6 6M15 9l-6 6"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  folder:
    '<path d="M3 6.5h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/>',
};

export function icon(name: IconName, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
