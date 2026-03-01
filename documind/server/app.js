/**
 * app.js — Servidor principal Documind RAG Chatbot
 *
 * Endpoints:
 *   POST   /api/upload          → sube y procesa PDF
 *   POST   /api/chat            → responde con RAG + agente web
 *   GET    /api/stats           → estadísticas del vectorstore
 *   DELETE /api/docs/:filename  → elimina documento
 *   DELETE /api/session/:id     → limpia historial
 */

require('dotenv').config();

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const vectorStore = require('./vectorStore');
const { processPDF }                                   = require('./pdfProcessor');
const { generateEmbeddings, generateChatResponse, runAgent } = require('./aiService');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Multer ────────────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename:    (_, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  limits:     { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 20) * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    file.mimetype === 'application/pdf'
      ? cb(null, true)
      : cb(new Error('Solo se permiten PDFs')),
});

// ── Sesiones en memoria ───────────────────────────────────────
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

// ─────────────────────────────────────────────────────────────
// RUTAS
// ─────────────────────────────────────────────────────────────

/** POST /api/upload */
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió PDF' });

  const { originalname, path: filePath } = req.file;
  console.log(`\n📤 Procesando: ${originalname}`);

  try {
    const chunks = await processPDF(filePath, originalname);
    if (!chunks.length) return res.status(422).json({ error: 'PDF sin texto extraíble' });

    const texts      = chunks.map((c) => c.text);
    const embeddings = await generateEmbeddings(texts);

    vectorStore.addDocuments(
      chunks.map((c, i) => ({ text: c.text, embedding: embeddings[i], metadata: c.metadata }))
    );

    const stats = vectorStore.getStats();
    console.log(`  ✅ ${stats.totalChunks} chunks totales en store\n`);
    res.json({ success: true, filename: originalname, chunks: chunks.length, stats });
  } catch (e) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error('  ❌', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/chat — RAG + Agente Web */
app.post('/api/chat', async (req, res) => {
  const { question, sessionId = 'default', useAgent = true } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'Pregunta vacía' });

  const stats = vectorStore.getStats();
  if (stats.totalChunks === 0 && !useAgent)
    return res.status(400).json({ error: 'No hay documentos cargados' });

  console.log(`\n💬 [${sessionId}] ${question}`);

  // Configurar SSE para streaming de estado del agente
  res.setHeader('Content-Type', 'application/json');

  try {
    // 1. Buscar contexto RAG
    const [qEmb] = await generateEmbeddings(question);
    const topK   = parseInt(process.env.TOP_K) || 5;
    const hits   = vectorStore.search(qEmb, topK);

    const ragContext = hits.length
      ? hits.map((h, i) => `[Frag. ${i+1} — "${h.metadata.filename}" · ${Math.round(h.score*100)}%]\n${h.text}`).join('\n\n---\n\n')
      : '';

    const ragSources = hits.map((h) => ({
      filename: h.metadata.filename,
      score:    Math.round(h.score * 100),
      preview:  h.text.substring(0, 140) + '...',
    }));

    // 2. Historial de conversación
    const history = getSession(sessionId);
    const chatHistory = history.slice(-8).map((m) => ({ role: m.role, content: m.content }));

    let answer, usedWeb = false, webSources = [], searchQuery = null, agentSteps = [];

    if (useAgent && process.env.ANTHROPIC_API_KEY) {
      // Modo agente: RAG + búsqueda web automática
      const result = await runAgent({
        question,
        ragContext,
        chatHistory,
        onStatus: (s) => { agentSteps.push(s); console.log(' ', s); },
      });
      answer      = result.answer;
      usedWeb     = result.usedWeb;
      webSources  = result.webSources;
      searchQuery = result.searchQuery;
    } else {
      // Modo simple: solo RAG
      history.push({ role: 'user', content: question });
      answer = await generateChatResponse(
        history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        ragContext || 'Sin documentos cargados'
      );
    }

    // Guardar en historial
    history.push({ role: 'user',      content: question });
    history.push({ role: 'assistant', content: answer   });
    if (history.length > 20) history.splice(0, 2);

    console.log(`  ✅ Respuesta generada (web: ${usedWeb})\n`);

    res.json({
      answer,
      ragSources,
      usedWeb,
      webSources,
      searchQuery,
      agentSteps,
    });
  } catch (e) {
    console.error('  ❌', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/stats */
app.get('/api/stats', (_, res) => res.json(vectorStore.getStats()));

/** DELETE /api/docs/:filename */
app.delete('/api/docs/:filename', (req, res) => {
  const removed = vectorStore.removeByFilename(decodeURIComponent(req.params.filename));
  res.json({ success: true, removed });
});

/** DELETE /api/session/:id */
app.delete('/api/session/:id', (req, res) => {
  sessions.delete(req.params.id);
  res.json({ success: true });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: `Archivo demasiado grande (máx ${process.env.MAX_FILE_SIZE_MB || 20}MB)` });
  if (err.message === 'Solo se permiten PDFs')
    return res.status(400).json({ error: err.message });
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Error interno' });
});

// ── Iniciar ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   🤖  Documind RAG Chatbot — Listo       ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  URL:       http://localhost:${PORT}         ║`);
  console.log(`║  Proveedor: ${(process.env.AI_PROVIDER || 'demo').padEnd(30)}║`);
  console.log(`║  Agente web: ${(process.env.ANTHROPIC_API_KEY ? 'activado' : 'desactivado').padEnd(29)}║`);
  console.log('╚══════════════════════════════════════════╝\n');
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY)
    console.log('⚠️  Sin API key. Configura .env para activar la IA real.\n');
});

module.exports = app;
