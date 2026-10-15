// Release notes (GitHub Markdown) as DOM: headings, lists, code, bold, links.
// No raw HTML; links only to http(s).

import { E } from '../e';

/** An address that is safe as a link target: https only (http for markdown links in notes). */
export function safeHref(url: string | null | undefined, allowHttp = false): string | null {
  if (!url) return null;
  return (allowHttp ? /^https?:\/\//i : /^https:\/\//i).test(url) ? url : null;
}

export function markdown(src: string): Node[] {
  const out: Node[] = [];
  const inline = (s: string): (Node | string)[] => {
    const parts: (Node | string)[] = [];
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g;
    let last = 0;
    for (let m: RegExpExecArray | null; (m = re.exec(s)); ) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      if (m[1]) parts.push(E('code', {}, m[1].slice(1, -1)));
      else if (m[2]) parts.push(E('b', {}, m[2].slice(2, -2)));
      else if (m[3]) parts.push(E('a', { href: m[4], target: '_blank', rel: 'noopener' }, m[3].replace(/^\[|\]\(.*$/g, '')));
      else if (m[5])
        parts.push(E('a', { href: m[5], target: '_blank', rel: 'noopener' }, m[5].replace(/^https?:\/\/(github\.com\/)?/, '')));
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };
  let list: HTMLElement | null = null;
  let para: string[] = [];
  let fence: string[] | null = null;
  const flush = () => {
    if (para.length) out.push(E('p', {}, inline(para.join(' '))));
    para = [];
    list = null;
  };
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (fence) {
      if (/^```/.test(line.trim())) {
        out.push(E('pre', {}, fence.join('\n')));
        fence = null;
      } else fence.push(raw);
      continue;
    }
    if (/^```/.test(line.trim())) {
      flush();
      fence = [];
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*[-*+]\s+(.*)$/.exec(line) ?? /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push(E('h5', {}, inline(h[2])));
    } else if (li) {
      if (para.length) flush();
      if (!list) {
        list = E('ul', {});
        out.push(list);
      }
      list.appendChild(E('li', {}, inline(li[1])));
    } else if (!line.trim()) flush();
    else {
      if (list) list = null;
      para.push(line.trim());
    }
  }
  if (fence) out.push(E('pre', {}, fence.join('\n')));
  flush();
  return out;
}

/**
 * Release notes as the router shows them: without the "What's new" heading
 * (the dialog says so) and without the Install section (it is installed).
 */
export function forRouter(md: string): string {
  const out: string[] = [];
  let skip = false;
  for (const line of md.replace(/\r/g, '').split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      skip = /^install\b/i.test(h[1].trim());
      if (/^what.s new$/i.test(h[1].trim())) continue;
    } else if (/^\*\*Full Changelog\*\*/.test(line)) skip = false;
    if (!skip) out.push(line);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
