// A network operator's name as people say it: the legal form that geolocation
// services keep ("PJSC Rostelecom", "ООО «Ромашка»", "Example LLC") left out.
// Pure.

const FORMS =
  /^(?:PJSC|OJSC|CJSC|JSC|PAO|OAO|ZAO|LLC|Ltd\.?|Inc\.?|GmbH|ПАО|ОАО|ЗАО|АО|ООО|ИП)\s+|\s*,?\s+(?:PJSC|OJSC|CJSC|JSC|LLC|L\.L\.C\.|Ltd\.?|Limited|Inc\.?|Corp\.?|GmbH|S\.A\.|B\.V\.|ПАО|ОАО|ЗАО|АО|ООО)$/gi;

/** An operator's name without its legal form and the quotes around what is left. */
export function plainOrg(org: string): string {
  let s = org.trim();
  for (let i = 0; i < 2; i++) s = s.replace(FORMS, '').trim();
  const q = s.match(/^[«"“](.*)[»"”]$/);
  return (q ? q[1] : s).trim() || org.trim();
}

/** "City · Operator" with the operator plain (the log's and the map's `where`). */
export const plainWhere = (where: string): string =>
  where
    .split(' · ')
    .map((part, i, all) => (i === all.length - 1 && all.length > 1 ? plainOrg(part) : part))
    .join(' · ');
