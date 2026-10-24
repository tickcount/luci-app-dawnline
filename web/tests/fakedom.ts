// Just enough of LuCI's E() and Node for modules that build elements, in Node.

class FakeNode {}

export class El extends FakeNode {
  children: (El | string)[] = [];
  constructor(
    public tag: string,
    public attrs: Record<string, unknown> = {},
    children: (El | string)[] = [],
  ) {
    super();
    this.children = [...children];
  }
  appendChild<T extends El | string>(c: T): T {
    this.children.push(c);
    return c;
  }
  get textContent(): string {
    return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
  }
}

export const text = (nodes: unknown[]) => nodes.map((n) => (typeof n === 'string' ? n : (n as El).textContent)).join('');

export function installFakeDom() {
  const g = globalThis as unknown as Record<string, unknown>;
  g.Node = FakeNode;
  g.window = { E: (tag: string, attrs: Record<string, unknown>, children: (El | string)[]) => new El(tag, attrs, children) };
}
