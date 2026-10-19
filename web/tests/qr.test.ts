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

  it('draws the day look with the night shapes, dark on white', () => {
    const night = qrSvg(LINK, 3, true, 'night');
    const day = qrSvg(LINK, 3, true, 'day');
    expect(day).toMatch(/<rect width="(\d+)" height="\1" fill="#ffffff"\/>/);
    expect(day).toContain('fill-rule="evenodd"');
    expect(day).not.toContain('crispEdges');
    // The same dots and eyes as at night, in the other colours; the mark's tile turns dark.
    expect(day.replace(/#ffffff/g, 'BG').replace(/#0a0a0a/g, 'FG')).toBe(night.replace(/#0a0a0a/g, 'BG').replace(/#f2f2f2/g, 'FG'));
  });

  it('gives a dense night code fuller dots', () => {
    expect(qrSvg(LINK, 3, true, 'night')).toContain('a0.42 0.42');
    expect(qrSvg(KEY, 3, true, 'night')).toContain('a0.48 0.48');
  });
});
