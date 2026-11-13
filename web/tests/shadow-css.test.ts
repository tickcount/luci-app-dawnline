import { describe, expect, it } from 'vitest';
import { hostSelector, shadowCss, splitList } from '../build/shadow-css.ts';

const o = { rootClasses: ['kbd', 'own-tsel'] };

describe('shadow-css', () => {
  it('turns the document root into the host', () => {
    expect(shadowCss(':root{--bg:#000}html{touch-action:manipulation}body{margin:0}')).toBe(
      ':host{--bg:#000}:host{touch-action:manipulation}:host{margin:0}',
    );
    expect(shadowCss('body.locked{overflow:hidden}html[lang] p{x:1}')).toBe(':host(.locked){overflow:hidden}:host([lang]) p{x:1}');
    expect(shadowCss('body.scrolled .edge-fade.top{opacity:1}')).toBe(':host(.scrolled) .edge-fade.top{opacity:1}');
  });

  it('leaves look-alikes and other selectors alone', () => {
    expect(shadowCss('.acc-body{a:1}.page-body,.html{b:2}button{c:3}')).toBe('.acc-body{a:1}.page-body,.html{b:2}button{c:3}');
    expect(shadowCss('*{box-sizing:border-box}::selection{color:red}')).toBe('*{box-sizing:border-box}::selection{color:red}');
  });

  it('moves the classes the page sets on <html> to the host', () => {
    expect(shadowCss('.kbd :focus-visible{outline:2px}.kbd .mi:focus-visible{x:1}', o)).toBe(
      ':host(.kbd) :focus-visible{outline:2px}:host(.kbd) .mi:focus-visible{x:1}',
    );
    expect(shadowCss('.own-tsel .mono::selection{x:1}.kbdx a{y:2}', o)).toBe(':host(.own-tsel) .mono::selection{x:1}.kbdx a{y:2}');
  });

  it('follows the host theme instead of the system colour scheme', () => {
    expect(shadowCss('@media (prefers-color-scheme: light){:root{--bg:#fff}.a,.b>i{c:1}}')).toBe(
      ':host([data-theme=light]){--bg:#fff}:host([data-theme=light]) .a,:host([data-theme=light]) .b>i{c:1}',
    );
    expect(shadowCss('@media(prefers-color-scheme:dark){html.kbd a{x:1}}', o)).toBe(':host([data-theme=dark].kbd) a{x:1}');
    expect(shadowCss('@media (prefers-color-scheme: light){.kbd a{x:1}:host(.on) b{y:2}}', o)).toBe(
      ':host([data-theme=light].kbd) a{x:1}:host([data-theme=light].on) b{y:2}',
    );
  });

  it('recurses into nesting at-rules and copies the rest', () => {
    expect(shadowCss('@media (max-width:559px){:root{--g:8px}@media (prefers-color-scheme:light){.a{b:1}}}')).toBe(
      '@media (max-width:559px){:host{--g:8px}:host([data-theme=light]) .a{b:1}}',
    );
    expect(shadowCss('@supports (x:y){html{a:b}}@container p (min-width:840px){.c{d:e}}')).toBe(
      '@supports (x:y){:host{a:b}}@container p (min-width:840px){.c{d:e}}',
    );
    const kf = '@keyframes spin{from{transform:none}to{transform:rotate(1turn)}}';
    expect(shadowCss(kf)).toBe(kf);
    expect(shadowCss('@charset "UTF-8";html{a:b}')).toBe('@charset "UTF-8";:host{a:b}');
  });

  it('keeps strings and functions with commas and braces whole', () => {
    expect(shadowCss('.a::before{content:"}{,"}body{b:1}')).toBe('.a::before{content:"}{,"}:host{b:1}');
    expect(splitList(':is(.a,.b) i,[data-x="1,2"],.c')).toEqual([':is(.a,.b) i', '[data-x="1,2"]', '.c']);
    expect(hostSelector(':root:not([data-x]) .bar')).toBe(':host(:not([data-x])) .bar');
  });

  it('refuses CSS with unbalanced braces', () => {
    expect(() => shadowCss('.a{b:1')).toThrow(/unbalanced/);
  });
});
