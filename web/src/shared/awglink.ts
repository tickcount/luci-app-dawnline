// The connection as an `awg://` link, the form V2RayTun imports (its Android
// app since 5.24.76 and its Windows app, both with AmneziaWG 2.0):
//
//   awg://<private key>@<host>:<port>?publickey=…&address=…&dns=…#<name>
//
// Every other line of the .conf goes in as a parameter under its own name in
// lower case (PresharedKey → presharedkey, Jc → jc, I1 → i1), its value
// percent-encoded; lists lose the spaces after their commas. Made from the
// .conf itself, so the link always says what the file says.
//
// Why awg:// and not amneziawg:// (Android's own export): both apps pick the
// AmneziaWG parser for either prefix, but the Windows one (AwgParser.
// tryParseAwgUri in its Dart snapshot) then refuses any scheme but "awg", and
// the import ends in "Error". Android's parser never looks at the scheme.
//
// What V2RayTun 5.26.83 reads (its parser, from the APK; Windows reads the
// same names): the keys in lower case; jc, jmin, jmax, s1–s4 as whole numbers,
// h1–h4 and i1–i5 as text (ranges and tags pass); no AmneziaWG 3.1 keys (its
// cores have none). The name is the fragment: a .conf imported there is named
// by the clock instead (and "Import from file" reads a file line by line, a
// link a line: a .txt with the link imports, a .conf does not). It hands the
// endpoint to its core as it is, and its Android core takes no name: `ip`,
// where given, goes in place of the server's name. Its Windows core
// (amneziawg-windows) resolves the name itself, so there it stays.

/** AmneziaWG 3.1's own lines (Maximum): V2RayTun's cores (amneziawg-go 0.2.16/0.2.18) have none. */
const V31 =
  /^\s*(HeaderProtectionKey|ContentPaddingAddition|RandomTrailers|DisableCookies|RekeyAfterTime|RekeyTimeout|RejectAfterTime|KeepaliveTimeout|MaxHandshakeAttempts)\s*=/im;

/** Whether V2RayTun can take this configuration: false for AmneziaWG 3.1 (the Maximum disguise). */
export const v2rFits = (conf: string): boolean => !V31.test(conf);

/** In the order V2RayTun's own export writes them; the disguise after them. */
const FIRST = ['publickey', 'address', 'dns', 'mtu', 'presharedkey', 'allowedips', 'persistentkeepalive'];
/** Lines that are lists: "1.1.1.1, 1.0.0.1" goes in as "1.1.1.1,1.0.0.1". */
const LISTS = new Set(['address', 'dns', 'allowedips']);

export function awgLink(conf: string, name: string, ip?: string | null): string {
  const lines = new Map<string, string>();
  for (const line of conf.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) lines.set(m[1].toLowerCase(), m[2]);
  }
  const priv = lines.get('privatekey') ?? '';
  // The last colon splits the port off, so a bracketed IPv6 host keeps its own.
  const ep = lines.get('endpoint') ?? '';
  const at = ep.lastIndexOf(':');
  const host = ip ? (ip.includes(':') ? `[${ip}]` : ip) : at > 0 ? ep.slice(0, at) : ep;
  const port = at > 0 ? ep.slice(at + 1) : '';
  lines.delete('privatekey');
  lines.delete('endpoint');
  const keys = [...FIRST.filter((k) => lines.has(k)), ...[...lines.keys()].filter((k) => !FIRST.includes(k))];
  const query = keys
    .map((k) => {
      const v = lines.get(k)!;
      return `${k}=${encodeURIComponent(LISTS.has(k) ? v.replace(/,\s+/g, ',') : v)}`;
    })
    .join('&');
  return `awg://${encodeURIComponent(priv)}@${host}${port ? `:${port}` : ''}?${query}#${encodeURIComponent(name)}`;
}
