// Which theme the admin shows: Outline switches light and dark in place with
// html[data-darkmode]; without it, the system's choice. Read where something
// is drawn in the theme's own colours (the map, QR codes).

export function isDark(): boolean {
  const attr = document.documentElement.getAttribute('data-darkmode');
  if (attr != null) return attr === 'true';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}
