/** Levenshtein distance; stops early and returns `max + 1` once the distance must exceed `max`. */
export function editDistance(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    let rowMin = row[0];
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = above;
      rowMin = Math.min(rowMin, row[j]);
    }
    if (rowMin > max) return max + 1;
  }
  return row[b.length];
}
