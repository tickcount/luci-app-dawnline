// What People's picks change (extend, pause, resume) as people_update lists,
// and the list that puts each person back as they were (the toast's Undo).
// Pure: the page sends them.

import type { PeopleChange } from '../api';
import type { Person } from '../../shared/types';
import { monthOn } from './lines';

export interface Bulk {
  changes: PeopleChange[];
  /** The same people as they were. */
  undo: PeopleChange[];
}

/** A month more for each picked person with an end date (people without one are left as they are). */
export function extendAll(people: Person[], today: string): Bulk {
  const ps = people.filter((p) => p.expires);
  return {
    changes: ps.map((p) => ({ id: p.id, patch: { expires: monthOn(p, today) } })),
    undo: ps.map((p) => ({ id: p.id, patch: { expires: p.expires } })),
  };
}

/** Pause (or resume) the picked people who are not paused (paused) yet. */
export function pauseAll(people: Person[], paused: boolean): Bulk {
  const ps = people.filter((p) => p.paused !== paused);
  return {
    changes: ps.map((p) => ({ id: p.id, patch: { paused } })),
    undo: ps.map((p) => ({ id: p.id, patch: { paused: p.paused } })),
  };
}

/** Whether a pick resumes: every picked person is paused. */
export const resumes = (people: Person[]): boolean => people.length > 0 && people.every((p) => p.paused);
