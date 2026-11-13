import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { joinStatus, unkey } from '../src/admin/state/join';

const DATA = new URL('../../backend/bridge/testdata/', import.meta.url);
const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, DATA), 'utf8'));

describe('a status from the topics', () => {
  it('joins what the bridge split back into the very answer', () => {
    // the Go side holds Split(status.json) to topics.json (backend/bridge/topics_test.go)
    const topics = read('topics.json');
    expect(joinStatus((name) => topics[name])).toEqual(read('status.json'));
  });

  it('waits for every topic', () => {
    const topics = read('topics.json');
    expect(joinStatus((name) => (name === 'people' ? undefined : topics[name]))).toBeNull();
  });

  it('reads keyed lists in their order, nulls, and leaves the rest', () => {
    expect(unkey({ order: ['b', 'a', 'gone'], items: { a: { id: 'a', link: { $null: true } }, b: { id: 'b', spark: [1, 2] } } })).toEqual([
      { id: 'b', spark: [1, 2] },
      { id: 'a', link: null },
    ]);
    // an object that only looks like one is left alone
    expect(unkey({ order: 'asc', items: 3 })).toEqual({ order: 'asc', items: 3 });
  });
});
