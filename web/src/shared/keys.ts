// Keys as a text field reads them.

/**
 * A word is still being composed (an input method's candidate is picked with Enter, in Japanese, Chinese, Korean):
 * that Enter is the keyboard's own, never «take what is typed». `isComposing` says it; Safari has already ended the
 * composition by the time the key arrives, and gives the key the code 229 instead.
 */
export const composing = (e: KeyboardEvent): boolean => e.isComposing || e.keyCode === 229;
