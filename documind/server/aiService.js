/**
 * aiService.js
 * Servicio de IA: embeddings, chat RAG y agente con búsqueda web.
 */

const axios = require('axios');

const PROVIDER = process.env.AI_PROVIDER || 'anthropic';

// ─── EMBEDDINGS ──────────────────────────────────────────────

async function getEmbeddingsOpenAI(texts) {
  const res = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', input: texts },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
  );
  return res.data.data.map((d) => d.embedding);
}

function mockEmbeddings(texts) {
  console.warn('⚠️  Embeddings simulados — configura OPENAI_API_KEY para resultados reales.');
  return texts.map(() => Array.from({ length: 384 }, () => (Math.random() - 0.5) * 2));
}

async function generateEmbeddings(textOrTexts) {
  const texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
  try {
    if (process.env.OPENAI_API_KEY) return await getEmbeddingsOpenAI(texts);
    return mockEmbeddings(texts);
  } catch (e) {
    console.error('Embeddings error:', e.message);
    return mockEmbeddings(texts);
  }
}

// ─── CLAUDE API HELPER ───────────────────────────────────────

async function callClaude({ system, messages, tools = null, maxTokens = 1500 }) {
  const body = {
    model:      process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system,
    messages,
  };
  if (tools) body.tools = tools;

  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    body,
    {
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
    }
  );
  return res.data;
}

function extractText(content) {
  if (!Array.isArray(content)) return content || '';
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

// ─── AGENTE RAG + WEB ────────────────────────────────────────

/**
 * Agente principal de 3 fases:
 *  1. Decide si necesita búsqueda web
 *  2. Busca en la web si es necesario
 *  3. Sintetiza RAG + web en respuesta natural
 */
async function runAgent({ question, ragContext, chatHistory, onStatus }) {
  // FASE 1 — Decisión
  onStatus('🤔 Analizando si necesito buscar en la web...');

  const decisionData = await callClaude({
    system: `Eres un agente inteligente. Analiza la pregunta y el contexto del documento.

CONTEXTO DEL DOCUMENTO (RAG):
${ragContext || 'Sin documentos cargados'}

Responde ÚNICAMENTE con JSON válido (sin markdown, sin texto extra):
{
  "needsWeb": true o false,
  "reason": "razón breve",
  "searchQuery": "query optimizado para Google (solo si needsWeb=true)"
}

needsWeb = true si:
- Requiere info actual/reciente (noticias, precios, eventos)
- El documento no tiene suficiente info
- Pregunta sobre tendencias o datos que cambian

needsWeb = false si:
- La respuesta está en el documento
- Es pregunta personal u opinión
- El contexto del documento es suficiente`,
    messages: [
      ...chatHistory.slice(-4),
      { role: 'user', content: question },
    ],
    maxTokens: 300,
  });

  let needsWeb = false;
  let searchQuery = question;
  let webContext = '';
  let webSources = [];

  try {
    const raw  = extractText(decisionData.content);
    const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
    needsWeb    = json.needsWeb === true;
    searchQuery = json.searchQuery || question;
  } catch {
    needsWeb = false;
  }

  // FASE 2 — Búsqueda web (si es necesaria)
  if (needsWeb) {
    onStatus(`🌐 Buscando en la web: "${searchQuery}"...`);
    try {
      const searchData = await callClaude({
        system: `Busca información actualizada sobre: "${searchQuery}". Usa la herramienta de búsqueda web.`,
        messages: [{ role: 'user', content: `Busca: ${searchQuery}` }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        maxTokens: 1500,
      });

      const allContent = searchData.content || [];

      // Si hay tool_use pendiente, hacer segunda llamada
      if (searchData.stop_reason === 'tool_use') {
        const toolUseBlocks = allContent.filter((b) => b.type === 'tool_use');
        const followUp = await callClaude({
          system: `Resume la información encontrada sobre "${searchQuery}" de forma clara.`,
          messages: [
            { role: 'user', content: `Busca: ${searchQuery}` },
            { role: 'assistant', content: allContent },
            {
              role: 'user',
              content: toolUseBlocks.map((tu) => ({
                type:        'tool_result',
                tool_use_id: tu.id,
                content:     'Resultados obtenidos.',
              })),
            },
          ],
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          maxTokens: 1500,
        });
        webContext = extractText(followUp.content);
      } else {
        webContext = extractText(allContent);
      }

      // Extraer fuentes web
      allContent.forEach((block) => {
        if (block.type === 'tool_result' || block.type === 'web_search_tool_result') {
          (block.content || []).forEach((item) => {
            if (item.type === 'web_search_result') {
              webSources.push({ title: item.title, url: item.url });
            }
          });
        }
      });

      onStatus('✅ Búsqueda web completada');
    } catch (e) {
      console.error('Web search error:', e.message);
      onStatus('⚠️ Búsqueda web no disponible, usando solo documentos...');
      needsWeb = false;
    }
  }

  // FASE 3 — Síntesis natural
  onStatus('✍️ Generando respuesta...');

  const synthesisSystem = `Eres un asistente experto y conversacional. Das respuestas naturales, fluidas y bien fundamentadas.

${ragContext ? `━━━ INFORMACIÓN DE LOS DOCUMENTOS DEL USUARIO ━━━
${ragContext}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : ''}

${needsWeb && webContext ? `━━━ INFORMACIÓN ACTUALIZADA DE LA WEB ━━━
${webContext}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : ''}

INSTRUCCIONES:
• Sintetiza ambas fuentes de forma natural y coherente
• Usa un tono conversacional y amigable
• Cita de dónde viene la info cuando sea relevante
• Responde en el idioma del usuario
• No uses formatos excesivamente rígidos, prioriza fluidez`;

  const finalData = await callClaude({
    system: synthesisSystem,
    messages: [
      ...chatHistory.slice(-6),
      { role: 'user', content: question },
    ],
  });

  return {
    answer:       extractText(finalData.content),
    usedWeb:      needsWeb,
    webSources,
    searchQuery:  needsWeb ? searchQuery : null,
  };
}

// ─── CHAT SIMPLE (sin agente) ────────────────────────────────

async function generateChatResponse(messages, context) {
  const system = `Eres un asistente experto. Responde ÚNICAMENTE basándote en el contexto proporcionado.

CONTEXTO:
${context}

Si la respuesta no está en el contexto, dilo claramente. Responde en el idioma del usuario.`;

  try {
    if (PROVIDER === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
      const data = await callClaude({ system, messages });
      return extractText(data.content);
    }
    if (PROVIDER === 'openai' && process.env.OPENAI_API_KEY) {
      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model:    process.env.OPENAI_CHAT_MODEL || 'gpt-3.5-turbo',
          messages: [{ role: 'system', content: system }, ...messages],
          max_tokens: 1000,
        },
        { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
      );
      return res.data.choices[0].message.content;
    }
    return `[DEMO — Sin API key] Pregunta: "${messages.at(-1)?.content}"\n\nContexto encontrado:\n${context.substring(0, 300)}...`;
  } catch (e) {
    throw new Error(`Error IA: ${e.response?.data?.error?.message || e.message}`);
  }
}

module.exports = { generateEmbeddings, generateChatResponse, runAgent };
