// Dawnline's mark: a sun over the horizon. The portal's crumbs carry it, so does the admin's wait while the router
// starts (admin/shell/waiting.ts), and a glass of it stands for Dawnline among the components (admin/ui/glass.ts).

/** The sun and the horizon, filled, in a 24 px box. */
export const MARK_SHAPES = '<path class="sun" d="M3 15a9 9 0 0 1 18 0z"/><rect class="bar" x="2" y="17" width="20" height="2" rx="1"/>';

/** The mark as its own svg: its sun rises from behind the line (clipped above the `.bar`). */
export const MARK =
  '<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="dl-sky"><rect width="24" height="17"/></clipPath></defs>' +
  '<g clip-path="url(#dl-sky)"><path class="sun" d="M3 15a9 9 0 0 1 18 0z"/></g><rect class="bar" x="2" y="17" width="20" height="2" rx="1"/></svg>';
