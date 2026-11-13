// A LuCI view's load and render around a page. The view file calls the
// factory once (`view.extend(app.overview())`) and LuCI makes the view anew
// from that one class on every visit, so the `load` and `render` here are
// shared by all visits: each visit gets a page object of its own (`pageFor`,
// called from load). One page kept across visits would be drawn into again
// with the boxes of its last visit still filled: coming back to Overview or
// People showed the page twice. No DOM of its own (main.ts hands the mount).
//
// LuCI shows its spinner for as long as `load` takes, so `load` here never waits for the router: it ends
// when the stylesheet is there. A page whose own load has answered by then is rendered from that; one that
// still waits for the router is handed over waiting, and stands as its section row (shell/waiting.ts) until
// its answer lands.

export interface Page<D> {
  load(): Promise<D>;
  render(data: D): HTMLElement;
}

/** What a view is rendered from: the page's data when its load answered at once, else the answer still on its way. */
export type Loaded<D> = { data: D } | { pending: Promise<D> };

/**
 * `redirect`: an old address sends the browser on instead of loading (null: stay). `mount`: draw the page
 * into what LuCI gets. `style`: the stylesheet's text, loaded beside the page's data.
 */
export function pageView<D, N>(
  pageFor: () => Page<D>,
  redirect: () => Promise<never> | null,
  mount: (page: Page<D>, got: Loaded<D>, css: string) => N,
  style: () => Promise<string>,
) {
  let page: Page<D> | null = null;
  let css = '';
  const open = async (): Promise<Loaded<D>> => {
    const pending = (page = pageFor()).load();
    // a refusal is told where the page waits (or by LuCI, when it came at once), never as an unhandled one
    pending.catch(() => undefined);
    css = await style();
    // "at once": by the time the stylesheet is there, and a turn of the loop
    return Promise.race([
      pending.then(
        (data): Loaded<D> => ({ data }),
        (): Loaded<D> => ({ pending }),
      ),
      new Promise<Loaded<D>>((done) => setTimeout(() => done({ pending }), 0)),
    ]);
  };
  return {
    load: (): Promise<Loaded<D>> => redirect() ?? open(),
    // rendered without a load of its own (it should not happen): a fresh page all the same
    render: (got: Loaded<D>): N => mount(page ?? pageFor(), got, css),
  };
}
