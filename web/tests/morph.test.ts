import { describe, expect, it } from 'vitest';
import { kept, paired } from '../src/portal/ui/morph';

/** The letters a morph keeps, as the new text shows them (the rest come in). */
const keeps = (from: string, to: string) =>
  kept([...from], [...to])
    .map(([, j]) => [...to][j])
    .join('');

describe('kept letters', () => {
  it('keeps what the two share at the end together', () => {
    expect(kept([...'iPad'], [...'Kitchen iPad'])).toEqual([
      [0, 8],
      [1, 9],
      [2, 10],
      [3, 11],
    ]);
  });

  it('keeps what they share at the start and at the end, and changes only the middle', () => {
    expect(keeps('2 of 3', '3 of 3')).toBe(' of 3');
    expect(keeps('Kitchen tablet', 'Kitchen iPad')).toBe('Kitchen a');
  });

  it('finds the letters in common between two different words', () => {
    expect(keeps('Scan', 'Create')).toBe('a');
    expect(keeps('Last 7 days', 'Thu 15 Oct')).toContain(' ');
  });

  it('keeps nothing between texts with nothing in common, and everything between equal ones', () => {
    expect(kept([...'abc'], [...'xyz'])).toEqual([]);
    expect(keeps('Connected', 'Connected')).toBe('Connected');
  });

  it('pairs indexes in order on both sides', () => {
    const pairs = kept([...'Not set up yet'], [...'Connected']);
    pairs.forEach(([i, j], n) => {
      if (!n) return;
      expect(i).toBeGreaterThan(pairs[n - 1][0]);
      expect(j).toBeGreaterThan(pairs[n - 1][1]);
    });
  });
});

describe('pieces paired by a refill', () => {
  it('pairs a keyed piece with its own key wherever it went, the rest in order', () => {
    // two rows swapped places, a head before them and a foot after
    const a = ['DIV.head.', 'DIV.row.a', 'DIV.row.b', 'DIV.foot.'];
    const b = ['DIV.head.', 'DIV.row.b', 'DIV.row.a', 'DIV.foot.'];
    expect(paired(a, b).sort((x, y) => x[1] - y[1])).toEqual([
      [0, 0],
      [2, 1],
      [1, 2],
      [3, 3],
    ]);
  });

  it('leaves a key that is not once on each side to the order', () => {
    expect(paired(['DIV.row.a', 'DIV.row.a'], ['DIV.row.a'])).toEqual(kept(['DIV.row.a', 'DIV.row.a'], ['DIV.row.a']));
    expect(paired(['#text', 'B..'], ['B..', '#text'])).toEqual(kept(['#text', 'B..'], ['B..', '#text']));
  });
});
