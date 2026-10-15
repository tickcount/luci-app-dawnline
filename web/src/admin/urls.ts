// Addresses of Dawnline's admin pages.

/** A server's People section (Servers page). */
export function peopleUrl(server?: string): string {
  return `${L.url('admin/network/dawnline/server')}?${server ? `server=${encodeURIComponent(server)}&` : ''}section=people`;
}

export function personUrl(id: string, device?: string): string {
  return `${L.url('admin/network/dawnline/person')}?id=${encodeURIComponent(id)}${device ? `&device=${encodeURIComponent(device)}` : ''}`;
}
