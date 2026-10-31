import { describe, expect, it } from 'vitest';
import { denseQr, qrFits, qrSvg, scannable } from '../src/shared/qr';

const LINK = 'https://engage.example.eu:4500/abcdef-ghijkl-mnopqr';
const KEY = `vpn://${'A1b2C3d4'.repeat(180)}`;
/** An AmneziaVPN key on Maximum where the browser cannot compress it: past what version 40-L holds. */
const HUGE = 'A1b2C3d4'.repeat(425);

describe('qr', () => {
  it('omits the centre mark on dense codes', () => {
    const link = qrSvg(LINK, 3, true, 'night');
    // The mark's light tile on a short code, none on a dense one.
    expect(link).toContain('<g transform');
    expect(denseQr(KEY)).toBe(true);
    expect(qrSvg(KEY, 3, true, 'night')).not.toContain('<g transform');
  });

  it('says a 3.4 KB text does not fit instead of throwing, and keeps it from the camera', () => {
    expect(qrFits(HUGE)).toBe(false);
    expect(scannable(HUGE)).toBe(false);
    // It still fits a code, but too fine to read off a screen.
    expect(qrFits(HUGE.slice(0, 2000))).toBe(true);
    expect(scannable(HUGE.slice(0, 2000))).toBe(false);
    expect(scannable(KEY)).toBe(true);
    expect(scannable(LINK)).toBe(true);
  });

  it('draws the same code after checking it fits, and the next text as itself', () => {
    const fresh = qrSvg(KEY, 3, true, 'night');
    qrFits(LINK);
    const link = qrSvg(LINK, 3, true, 'night');
    expect(qrFits(KEY)).toBe(true);
    expect(qrSvg(KEY, 3, true, 'night')).toBe(fresh);
    expect(qrSvg(LINK, 3, true, 'night')).toBe(link);
    expect(link).not.toBe(fresh);
  });
});
