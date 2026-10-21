// A device's name as it is typed, in the portal and the admin: what the router would refuse never gets in. A
// character it doesn't take (letters of any language, digits, spaces and - _ . only) or one past DEVICE_NAME_MAX is turned
// away as it is typed, pasted or dropped, `field` shakes and `tell` gets a short reason for the field's red line,
// then null once a change gets in. Nothing is asked of the router for it. Emptying the field is fine as it
// happens: a submit says so. The router checks the same on its own (util.uc): this only spares the round trip.

import { DEVICE_NAME_MAX, deviceNameChar, deviceNameFits } from './format';
import { fmt, num } from './i18n';
import { shake } from './shake';

/** Why `next` doesn't fit, short enough for a card's status line: a character it doesn't take, else its length. */
function why(next: string): string {
  return [...next].every(deviceNameChar) ? fmt(_('Up to %s characters.'), num(DEVICE_NAME_MAX)) : _('Only letters, digits, - _ .');
}

/**
 * Call it as the input is built, before its own `input` listeners: a refused change is undone before they see it.
 * `field`: what shakes (a getter, for a field built after its input); the input itself by default. `look`: as
 * shake() takes it (no red ring for a field drawn without one).
 */
export function guardDeviceName(
  input: HTMLInputElement,
  field: HTMLElement | (() => HTMLElement) = input,
  tell: (why: string | null) => void = () => {},
  look: { ring?: boolean } = {},
) {
  const box = () => (typeof field === 'function' ? field() : field);
  let last = input.value;
  input.addEventListener('beforeinput', (e) => {
    last = input.value;
    // Deleting is always fine; typing through an IME is checked once it lands (it can't be refused mid-way).
    if (e.inputType.startsWith('delete') || e.isComposing || e.inputType === 'insertCompositionText') return;
    const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
    const s = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? s;
    const next = input.value.slice(0, s) + text + input.value.slice(end);
    if (deviceNameFits(next)) return;
    e.preventDefault();
    shake(box(), look);
    tell(why(next));
  });
  // What got in anyway (an IME's letters, autofill): back to what it was, caret where it stood. Deleting stays
  // (an old name the rules came after is shortened a letter at a time).
  input.addEventListener('input', (e) => {
    const deleting = e instanceof InputEvent && e.inputType.startsWith('delete');
    if (deleting || deviceNameFits(input.value)) {
      last = input.value;
      tell(null);
      return;
    }
    const next = input.value;
    const at = Math.min(input.selectionStart ?? last.length, last.length);
    input.value = last;
    input.setSelectionRange(at, at);
    e.stopImmediatePropagation();
    shake(box(), look);
    tell(why(next));
  });
}
