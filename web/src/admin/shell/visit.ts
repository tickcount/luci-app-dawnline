// Going to another address of the admin from code (a menu's «Open», a map
// marker, a fix that leads to a person). A page that shows several addresses
// in one view (People: its panels, its map) takes those of its own and moves
// inside itself, without a page load; every other address is the browser's.

/** The page's own way to an address: true when it took it. */
let own: ((url: string) => boolean) | null = null;
/** The way to another page of Dawnline's without leaving the view (shell/pages.ts). */
let shell: ((url: string) => boolean) | null = null;

/** Go to `url`: inside the page when it is one of its own, to another page of Dawnline's in place, else by loading it. */
export function visit(url: string) {
  if (!own?.(url) && !shell?.(url)) location.href = url;
}

/** `take` opens Dawnline's other pages in place (true: taken). */
export function shellVisits(take: (url: string) => boolean) {
  shell = take;
}

/** `take` gets every address visited from now on (true: taken); returns the way to stop. */
export function ownVisits(take: (url: string) => boolean): () => void {
  own = take;
  return () => {
    if (own === take) own = null;
  };
}
