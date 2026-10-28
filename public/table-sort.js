// Classic script, loaded by the panel page before panel-client.js and by test/table-sort.test.js through node:vm.
const isNil = (value) => value === null || value === undefined || value === '';
const asNumber = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) ? Number(value) : null;

function compareTableValues(a, b, dir) {
  if (isNil(a) || isNil(b)) return isNil(a) === isNil(b) ? 0 : isNil(a) ? 1 : -1;
  const sign = dir === 'desc' ? -1 : 1;
  const numA = asNumber(a);
  const numB = asNumber(b);
  if (numA !== null && numB !== null) return sign * (numA - numB);
  return sign * String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}
