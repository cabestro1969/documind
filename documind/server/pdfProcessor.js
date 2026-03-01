/**
 * pdfProcessor.js
 * Extrae texto de PDFs y divide en chunks optimizados para RAG.
 */

const pdfParse = require('pdf-parse');
const fs       = require('fs');

const CHUNK_SIZE    = parseInt(process.env.CHUNK_SIZE)    || 600;
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP) || 80;

async function extractTextFromPDF(filePath) {
  const buf  = fs.readFileSync(filePath);
  const data = await pdfParse(buf);
  return { text: data.text, numPages: data.numpages, info: data.info || {} };
}

function cleanText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\f/g, '\n')
    .trim();
}

function splitIntoChunks(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    const t = para.trim();
    if (!t) continue;
    if (current.length + t.length + 2 <= chunkSize) {
      current += (current ? '\n\n' : '') + t;
    } else {
      if (current) {
        chunks.push(current.trim());
        current = current.slice(-overlap) + '\n\n' + t;
      } else {
        const sentences = t.split(/(?<=[.!?])\s+/);
        for (const s of sentences) {
          if (current.length + s.length + 1 <= chunkSize) {
            current += (current ? ' ' : '') + s;
          } else {
            if (current) { chunks.push(current.trim()); current = current.slice(-overlap) + ' ' + s; }
            else         { chunks.push(s.substring(0, chunkSize)); current = s.slice(-overlap); }
          }
        }
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 20);
}

async function processPDF(filePath, filename) {
  const { text, numPages, info } = await extractTextFromPDF(filePath);
  const cleaned = cleanText(text);
  if (!cleaned || cleaned.length < 10)
    throw new Error('El PDF no contiene texto extraíble (puede ser escaneado).');

  const chunks = splitIntoChunks(cleaned);
  console.log(`📄 ${filename}: ${numPages} págs → ${chunks.length} chunks`);

  return chunks.map((chunk, i) => ({
    text: chunk,
    metadata: {
      filename,
      chunkIndex:  i,
      totalChunks: chunks.length,
      numPages,
      title:       info.Title || filename,
      processedAt: new Date().toISOString(),
    },
  }));
}

module.exports = { processPDF };
