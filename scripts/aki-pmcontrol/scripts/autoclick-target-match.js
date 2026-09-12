/**
 * Remove Postman's trailing action-count badge text without broadening the
 * underlying keyword match. Counts are positive integers: (1), (2), ...
 */
function normalizeAutoClickLabel(text) {
  return text.replace(/\s+\([1-9]\d*\)$/, '');
}

function matchesAutoClickTarget(text, target) {
  const normalized = normalizeAutoClickLabel(text);
  return target.keywords.some((keyword) => (
    target.matchExact
      ? normalized === keyword
      : (normalized === keyword || normalized.includes(keyword))
  ));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeAutoClickLabel, matchesAutoClickTarget };
}
