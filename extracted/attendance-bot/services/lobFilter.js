const { normalizeText } = require('./timeConverter');

function normalizeLob(value) {
  return normalizeText(value || 'Unspecified')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getUniqueLobs(records) {
  const map = new Map();

  for (const record of records) {
    const lob = record.lob || 'Unspecified';
    const key = normalizeLob(lob);

    if (!map.has(key)) {
      map.set(key, lob);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
}

function filterRecordsByLob(records, selectedLobs = []) {
  if (!Array.isArray(selectedLobs) || selectedLobs.length === 0) {
    return records;
  }

  const normalized = selectedLobs.map(normalizeLob);

  if (normalized.includes('all lobs') || normalized.includes('all')) {
    return records;
  }

  return records.filter((record) =>
    normalized.includes(normalizeLob(record.lob || 'Unspecified'))
  );
}

module.exports = {
  normalizeLob,
  getUniqueLobs,
  filterRecordsByLob
};