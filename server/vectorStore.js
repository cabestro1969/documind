/**
 * vectorStore.js
 * Base vectorial en memoria con similitud coseno.
 */

class VectorStore {
  constructor() {
    this.documents = [];
  }

  addDocuments(items) {
    return items.map(({ text, embedding, metadata }) => {
      const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.documents.push({ id, text, embedding, metadata });
      return id;
    });
  }

  cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na  += a[i] * a[i];
      nb  += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }

  search(queryEmbedding, topK = 5) {
    if (!this.documents.length) return [];
    return this.documents
      .map((doc) => ({
        text:     doc.text,
        score:    this.cosineSimilarity(queryEmbedding, doc.embedding),
        metadata: doc.metadata,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter((d) => d.score > 0.05);
  }

  removeByFilename(filename) {
    const before = this.documents.length;
    this.documents = this.documents.filter(
      (d) => d.metadata.filename !== filename
    );
    return before - this.documents.length;
  }

  getStats() {
    const files = [...new Set(this.documents.map((d) => d.metadata.filename))];
    return { totalChunks: this.documents.length, totalFiles: files.length, files };
  }

  clear() { this.documents = []; }
}

module.exports = new VectorStore();
