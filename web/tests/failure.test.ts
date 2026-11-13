import { describe, expect, it, vi } from 'vitest';
import { failureKind, failureText } from '../src/admin/failure';

describe('failure', () => {
  it('says a sentence as it came: the backend refusal, the page’s own, in any script', () => {
    expect(failureKind(new Error('Port 51820 is already taken.'))).toBe('said');
    expect(failureKind(new Error('Порт 51820 уже занят.'))).toBe('said');
    expect(failureText(new Error('  Port 51820 is already taken. '))).toBe('Port 51820 is already taken.');
  });

  it('tells LuCI’s reports of the bus by their code', () => {
    const rpc = (tail: string) => new Error(`RPC call to dawnline/status failed with ${tail}`);
    expect(failureKind(rpc('ubus code 4: Resource not found'))).toBe('away');
    expect(failureKind(rpc('ubus code 10: Connection lost'))).toBe('away');
    expect(failureKind(rpc('ubus code 7: Request timeout'))).toBe('slow');
    expect(failureKind(rpc('ubus code 6: Permission denied'))).toBe('denied');
    expect(failureKind(rpc('ubus code 3: Method not found'))).toBe('mismatch');
    expect(failureKind(rpc('error -32002: Access denied'))).toBe('session');
    expect(failureKind(rpc('error -32000: Object not found'))).toBe('away');
    expect(failureKind(rpc('HTTP error 0: ?'))).toBe('offline');
    expect(failureKind(rpc('HTTP error 502: Bad Gateway'))).toBe('server');
    expect(failureKind(new Error('RPC call to dawnline/status returned invalid message frame'))).toBe('mismatch');
  });

  it('tells the network’s and the engine’s own, and a programmer’s text', () => {
    expect(failureKind(new Error('XHR request timed out'))).toBe('slow');
    expect(failureKind(new TypeError('Failed to fetch'))).toBe('offline');
    expect(failureKind(new TypeError('Cannot read properties of undefined'))).toBe('bug');
    expect(failureKind(new Error('integrity'))).toBe('bug');
    expect(failureKind(new Error('open /etc/config/dawnline: no such file or directory'))).toBe('bug');
    expect(failureKind(undefined)).toBe('bug');
  });

  it('never shows what it does not say, and puts it in the console once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const e = new Error('RPC call to dawnline/updates_notes failed with ubus code 4: Resource not found');
    const text = failureText(e);
    expect(text).not.toContain('RPC');
    expect(text).toMatch(/^Dawnline is not answering/);
    failureText(e);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
