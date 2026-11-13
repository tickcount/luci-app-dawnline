// What a Health check's fix (health.uc: its `fix` id) is called on its
// button: System's Health row and the Server page's notices say it the
// same. Pure.

/** The button of a backend fix, by its id. */
export function fixLabel(fix: string): string {
  const labels: Record<string, string> = {
    apply: _('Repair'),
    sync: _('Reload devices'),
    restart: _('Restart service'),
    netrestart: _('Restart network'),
    updates: _('Open Updates'),
  };
  return labels[fix] ?? (fix.startsWith('install:') ? _('Install') : _('Fix'));
}
