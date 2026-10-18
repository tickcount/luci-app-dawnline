import { describe, expect, it } from 'vitest';
import { denseQr, qrSvg } from '../src/shared/qr';

const LINK = 'https://engage.example.eu:4500/abcdef-ghijkl-mnopqr';
const KEY = `vpn://${'A1b2C3d4'.repeat(180)}`;

describe('qr', () => {
  it('draws the plain look as black squares on white in one path', () => {
    const svg = qrSvg(LINK);
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).not.toContain('evenodd');
  });

  it('draws the night look as light dots on black with eyes, marked on links only', () => {
    const link = qrSvg(LINK, 3, true, 'night');
    expect(link).toContain('fill="#0a0a0a"');
    expect(link).toContain('fill-rule="evenodd"');
    expect(link).not.toContain('crispEdges');
    // The mark's light tile on a short code, none on a dense one.
    expect(link).toContain('fill="#f2f2f2"/><g transform');
    expect(denseQr(KEY)).toBe(true);
    expect(qrSvg(KEY, 3, true, 'night')).not.toContain('<g transform');
  });

  it('gives a dense night code fuller dots', () => {
    expect(qrSvg(LINK, 3, true, 'night')).toContain('a0.42 0.42');
    expect(qrSvg(KEY, 3, true, 'night')).toContain('a0.48 0.48');
  });
});
