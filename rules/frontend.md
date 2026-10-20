# Frontend (TypeScript: admin UI and portal)

Read with `code-standards.md` and, for anything visible, `ui-design.md` and `i18n.md` (every visible string goes through `_()`).

## Code

- Strict TS, no `any` without a comment; types for RPC answers live in `shared/types.ts` / `admin/api.ts` and mirror the backend's shapes.
- Layout of `web/src/admin`: `ui/` generic components (button, menu, modal, drawer, tooltip, toast, controls), `widgets/` composite house widgets, `state/` polling and scoping, `events/` the activity vocabulary (model without DOM, render separate), `updater/` the Components data layer, `cores/` per-protocol bits, `pages/<page>/` one folder per page split by section, `styles/*.css` one file per feature joined in `styles/index.ts`. Shared with the portal: `src/shared/`.
- Pages build from `ui/` and `widgets/`; a page never defines a generic component. Logic that does not touch the DOM (formatting, models, CSV, sorting) lives outside the render code and gets tests.

## Live data

- Admin pages use `createPoller` (`state/poller.ts`): newest answer wins, no repaint of a region that holds focus, every RPC failure shows a toast or an inline error, never a blank section.
- Changes reach open pages through the revision (`state/live.ts`): one small `rev` call every 2 s while the page is visible; pollers that opt in (`live: true`) refresh when it moves. Their own `every` stays as a slow fallback.
- The portal does not poll (each request is a CGI process on the router, see `backend.md`): it loads once, after the visitor's own changes, and while it waits for a new device's first connection.

## Checks

- In `web/`: `npm run format:check`, `npm run typecheck`, `npm run i18n:check`, `npm test`, `npm run build`; the rebuilt bundles under `package/` and the catalogs are committed (CI fails otherwise).
