/**
 * Okapi BM25 over pre-tokenized documents, backed by an inverted index so a query only touches
 * the documents that contain its terms.
 */
export class Bm25Index {
  constructor(docs, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.size = docs.length;
    this.lengths = docs.map((d) => d.length);
    this.avgLength = this.lengths.reduce((sum, n) => sum + n, 0) / Math.max(docs.length, 1);
    this.postings = new Map();
    docs.forEach((doc, i) => {
      const counts = new Map();
      for (const term of doc) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const [term, tf] of counts) {
        if (!this.postings.has(term)) this.postings.set(term, []);
        this.postings.get(term).push([i, tf]);
      }
    });
  }

  has(term) {
    return this.postings.has(term);
  }

  terms() {
    return this.postings.keys();
  }

  /** Scores every document for weighted query terms ([term, weight] pairs); unmatched documents score 0. */
  score(weightedTerms) {
    const scores = new Array(this.size).fill(0);
    for (const [term, weight] of weightedTerms) {
      const postings = this.postings.get(term);
      if (!postings) continue;
      const idf = Math.log(1 + (this.size - postings.length + 0.5) / (postings.length + 0.5));
      for (const [doc, tf] of postings) {
        const norm = 1 - this.b + (this.b * this.lengths[doc]) / this.avgLength;
        scores[doc] += weight * idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * norm));
      }
    }
    return scores;
  }
}
