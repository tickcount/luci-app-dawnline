// What this login may do here: LuCI grants each view read or write through
// the menu path's ACL (rpcd's acl.d: a read-only login gets the read list of
// methods). A read-only page shows values without the controls that would fail.

/** False for a read-only login on this view; true where LuCI cannot say (an older LuCI). */
export const canWrite = (): boolean => L.hasViewPermission?.() !== false;
