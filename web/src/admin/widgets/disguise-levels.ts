// The disguise as a level: three tiles (ui/option-tiles.ts), each two meters (how hidden the traffic is, how fast
// it stays) with their words, and the apps that take it, in place of three paragraphs to compare. The one a server
// uses carries the mark; one picked and waiting for «Apply» carries it in warn, the one still running a dot. A
// level this router cannot run is dimmed and says what it needs. Settings › Disguise and the new server's sheet
// draw it: the page as three tiles to compare, the sheet (too narrow for three) as a track of the three with the
// picked one's meters and apps under it (levelPick).

import type { AwgCaps } from '../../shared/types';
import { h } from '../../portal/dom';
import { fact, factCap, facts, meter, optionTiles, type OptionState } from '../ui/option-tiles';
import { tabs } from '../ui/tabs';
import { methods, needsText, runs, type Method } from '../disguise';
import { putChildren } from '../../portal/ui/put';

/** What each level costs and buys, as levels of three with their words; the apps that take it. */
/** The words of a level's meters: also what the sheet's compact pick says. */
const levels = (): Record<
  Method,
  { hide: 0 | 1 | 2 | 3; hides: string; speed: 0 | 1 | 2 | 3; speeds: string; apps: string[]; not?: string }
> => ({
  off: { hide: 0, hides: _('Easy to block'), speed: 3, speeds: _('Full speed'), apps: [_('Any WireGuard app')] },
  balanced: {
    hide: 2,
    hides: _('Does not look like a VPN'),
    speed: 3,
    speeds: _('Almost as fast'),
    apps: ['AmneziaWG 2.0+', 'AmneziaVPN 4.8.12+'],
  },
  max: {
    hide: 3,
    hides: _('For networks that block hard'),
    speed: 2,
    speeds: _('Slower'),
    apps: ['AmneziaWG 3.1+'],
    not: _('not V2RayTun'),
  },
});

/**
 * `now`: the level in use; `next`: one picked and waiting to be applied (null: none); `pick`: a tile pressed (the
 * one in use, while another waits: the caller takes the waiting one back); `tools`: AmneziaWG is installed at all.
 */
export function levelTiles(o: {
  caps: AwgCaps;
  tools: boolean;
  now?: string;
  next: Method | null;
  write: boolean;
  pick(m: Method): void;
}): HTMLElement {
  const L = levels();
  return optionTiles<Method>({
    label: _('Disguise'),
    cls: 'kt-op-lvl',
    write: o.write,
    options: methods().map((m) => {
      const l = L[m.id];
      const ok = runs(m, o.caps) && o.tools;
      const state: OptionState = o.next === m.id ? 'next' : m.id === o.now ? (o.next ? 'was' : 'on') : '';
      const none = fact(l.not ?? '');
      none.classList.add('plain');
      return {
        id: m.id,
        title: m.title,
        state,
        off: !ok,
        body: [
          meter('eye', l.hide, l.hides, _('Hidden')),
          meter('zap', l.speed, l.speeds, _('Speed')),
          factCap(ok || !m.needs ? _('Apps') : _('Not on this router')),
          ok || !m.needs ? facts(...l.apps.map((a) => fact(a)), l.not ? none : null) : facts(fact(needsText(m.needs, o.tools))),
        ],
      };
    }),
    pick: o.pick,
  });
}

/**
 * The same choice where three tiles do not fit (a sheet): the levels on a track under short names, and under it
 * what the picked one costs and buys. A level this router cannot run stays on the track; picked, it says what it
 * needs and the choice goes back.
 */
export function levelPick(o: { caps: AwgCaps; tools: boolean; picked: Method; pick(m: Method): void }): HTMLElement {
  const L = levels();
  const all = methods();
  // short names: three must fit a sheet's track
  const short: Record<Method, string> = { off: _('Off'), balanced: _('Balance'), max: _('Max', 'disguise') };
  const box = h('div', { class: 'kt-lp' });
  let picked = o.picked;
  const draw = (shown: Method) => {
    const m = all.find((x) => x.id === shown)!;
    const l = L[shown];
    const ok = runs(m, o.caps) && o.tools;
    const none = fact(l.not ?? '');
    none.classList.add('plain');
    putChildren(box, [
      tabs<Method>(
        all.map((x) => ({ id: x.id, label: short[x.id] })),
        picked,
        (id) => {
          const can =
            runs(
              all.find((x) => x.id === id)!,
              o.caps,
            ) && o.tools;
          if (can) o.pick((picked = id));
          draw(id);
        },
        { cls: 'kt-lp-track', label: _('Disguise'), keep: 'disguise-level' },
      ).el,
      h(
        'div',
        { class: `kt-lp-p${ok ? '' : ' off'}` },
        meter('eye', l.hide, l.hides, _('Hidden')),
        meter('zap', l.speed, l.speeds, _('Speed')),
        ok || !m.needs
          ? facts(...l.apps.map((a) => fact(a)), l.not ? none : null)
          : h('span', { class: 'kt-lp-no' }, `${_('Not on this router')}: ${needsText(m.needs, o.tools)}`),
      ),
    ]);
  };
  draw(picked);
  return box;
}
