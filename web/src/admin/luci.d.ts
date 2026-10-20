// Minimal typings for the parts of the LuCI client SDK (luci.js / ui.js /
// rpc.js / poll.js / dom.js) that Dawnline uses. The module is evaluated by
// LuCI's loader, which injects the `'require'`d classes as these identifiers.

type Child = Node | string | number | null | undefined | false | Child[];

interface ElementAttrs {
  [key: string]: unknown;
  class?: string;
  style?: string;
  click?: (ev: MouseEvent) => void;
  change?: (ev: Event) => void;
  input?: (ev: Event) => void;
  keydown?: (ev: KeyboardEvent) => void;
}

interface LuciWidget {
  render(): Node | Promise<Node>;
  getValue(): any;
  setValue(v: any): void;
  isValid(): boolean;
  triggerValidation(): void;
  setChangeEvents?(node: Node, ...events: string[]): void;
  node?: HTMLElement;
}

interface WidgetOptions {
  id?: string;
  name?: string;
  optional?: boolean;
  datatype?: string;
  placeholder?: string;
  validate?: (value: string) => true | string;
  disabled?: boolean;
  readonly?: boolean;
  widget?: 'select' | 'radio' | 'checkbox';
  sort?: boolean | string[];
  create?: boolean;
  multiple?: boolean;
  size?: number;
  rows?: number;
  cols?: number;
  monospace?: boolean;
  password?: boolean;
  value_enabled?: string;
  value_disabled?: string;
  hiddenname?: string;
}

interface LuciUI {
  /** The menu is cached for the session; flush it after Dawnline's pages change. */
  menu?: { flushCache(): void };
  showModal(title: string | null, children: Child, ...classes: string[]): HTMLElement;
  hideModal(): void;
  addNotification(title: string | null, children: Child, ...classes: string[]): HTMLElement;
  addTimeLimitedNotification(title: string | null, children: Child, timeout?: number, ...classes: string[]): HTMLElement;
  changes: any;
  itemlist(node: Node, items: unknown[], separators?: unknown): HTMLElement;
  createHandlerFn(ctx: unknown, fn: string | ((...args: any[]) => unknown), ...args: unknown[]): (ev: Event) => void;
  Textfield: new (value: string | null, options?: WidgetOptions) => LuciWidget;
  Textarea: new (value: string | null, options?: WidgetOptions) => LuciWidget;
  Select: new (value: string | string[] | null, choices: Record<string, string | Node>, options?: WidgetOptions) => LuciWidget;
  Checkbox: new (value: string | null, options?: WidgetOptions) => LuciWidget;
  DynamicList: new (values: string[] | null, choices?: Record<string, string>, options?: WidgetOptions) => LuciWidget;
  Dropdown: new (value: string | string[] | null, choices: Record<string, string | Node>, options?: WidgetOptions) => LuciWidget;
}

interface LuciRpc {
  declare<T = any>(spec: {
    object: string;
    method: string;
    params?: string[];
    expect?: Record<string, unknown>;
    filter?: (data: any, args: unknown[], ...extra: unknown[]) => any;
    reject?: boolean;
  }): (...args: any[]) => Promise<T>;
}

interface LuciPoll {
  add(fn: () => unknown, interval?: number): boolean;
  remove(fn: () => unknown): boolean;
  start(): void;
  stop(): void;
  active(): boolean;
}

interface LuciDom {
  content(node: Node, children: Child): Node;
  findClassInstance(node: Node): any;
  append(node: Node, children: Child): Node;
  isEmpty(node: Node): boolean;
}

interface LuciEnv {
  sessionid?: string;
  rpctimeout?: number;
  [key: string]: unknown;
}

interface LuciL {
  env: LuciEnv;
  url(...parts: string[]): string;
  resolveDefault<T>(p: Promise<T>, def: T): Promise<T>;
  resource(...parts: string[]): string;
  itemlist(node: Node, items: unknown[], separators?: unknown): HTMLElement;
  bind<F extends (...args: any[]) => any>(fn: F, self: unknown, ...args: unknown[]): F;
  raise(type: string, fmt: string, ...args: unknown[]): never;
}

declare global {
  interface String {
    format(...args: unknown[]): string;
  }

  const E: (tag: string, attrs?: ElementAttrs | Child, children?: Child) => HTMLElement;
  const L: LuciL;
  const ui: LuciUI;
  const rpc: LuciRpc;
  const poll: LuciPoll;
  const dom: LuciDom;
  const baseclass: { extend<T>(props: T): T };
}

export type { Child, LuciWidget, WidgetOptions };
