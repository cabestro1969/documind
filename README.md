# 🤖 Documind — RAG Chatbot + Web Agent

Chatbot con IA que combina tus documentos PDF con búsqueda web en tiempo real.  
Powered by **Claude Sonnet** · Stack: Node.js + Express + HTML/CSS/JS

---

## ⚡ Inicio Rápido (Windows 11)

### 1. Instalar requisitos

- **Node.js**: https://nodejs.org → descargar versión LTS → instalar
- **Git**: https://git-scm.com/download/win → instalar con opciones por defecto

### 2. Configurar el proyecto

```bash
# Abre PowerShell en la carpeta del proyecto (clic derecho → "Abrir en Terminal")
npm install

# Copia el archivo de configuración
copy .env.example .env
```

Edita `.env` con el Bloc de Notas y añade tu API key:
```
ANTHROPIC_API_KEY=sk-ant-tu-clave-aqui
AI_PROVIDER=anthropic
```

Consigue tu API key en: https://console.anthropic.com

### 3. Ejecutar localmente

```bash
npm run dev
```

Abre http://localhost:3000 en tu navegador 🎉

---

## 🚀 Publicar en Vercel (URL pública gratis)

### Paso 1 — Subir a GitHub

```bash
git init
git config --global user.email "tu@email.com"
git config --global user.name "Tu Nombre"
git add .
git commit -m "Documind RAG Chatbot"
```

Crea un repo en https://github.com/new (sin README, sin .gitignore)

```bash
git remote add origin https://github.com/TU_USUARIO/documind.git
git push -u origin main
```

> Cuando pida contraseña, usa un Personal Access Token de GitHub:
> GitHub → Settings → Developer Settings → Personal Access Tokens → Generate new token (classic)
> Marca el permiso `repo` y copia el token como contraseña.

### Paso 2 — Deploy en Vercel

1. Ve a https://vercel.com → Sign up con GitHub
2. Click **Add New → Project**
3. Importa tu repositorio `documind`
4. Configuración:
   - **Framework**: Other
   - **Build Command**: `npm install`
   - **Output Directory**: `public`
5. En **Environment Variables** añade:
   - `ANTHROPIC_API_KEY` = tu clave de Anthropic
   - `AI_PROVIDER` = `anthropic`
   - `ANTHROPIC_MODEL` = `claude-sonnet-4-20250514`
6. Click **Deploy**

✅ En ~1 minuto tendrás tu URL: `https://documind-xxx.vercel.app`

---

## 🔑 Obtener API Key de Anthropic

1. Ve a https://console.anthropic.com
2. Regístrate o inicia sesión
3. Settings → API Keys → Create Key
4. Copia la clave (empieza por `sk-ant-...`)

---

## 🧠 Cómo funciona el agente

Cada pregunta pasa por **3 fases automáticas**:

1. **Decisión**: Claude analiza si necesita buscar en la web o si el documento es suficiente
2. **Búsqueda dual**: RAG en tus PDFs + búsqueda web en tiempo real (si es necesario)
3. **Síntesis**: Claude combina ambas fuentes en una respuesta natural y fluida

---

## 📁 Estructura

```
documind/
├── server/
│   ├── app.js           # Servidor Express + rutas API
│   ├── aiService.js     # Agente IA + embeddings + web search
│   ├── pdfProcessor.js  # Extracción y chunking de PDFs
│   └── vectorStore.js   # Base vectorial en memoria
├── public/
│   ├── index.html       # Interfaz de usuario
│   ├── css/style.css    # Estilos
│   └── js/app.js        # Lógica del frontend
├── uploads/             # PDFs temporales
├── .env.example         # Plantilla de configuración
├── vercel.json          # Config para deploy en Vercel
└── package.json
```

---

## 📋 Scripts

```bash
npm run dev    # Desarrollo con hot-reload
npm start      # Producción
```

## 🆘 Problemas comunes

**"Cannot find module"** → ejecuta `npm install`

**"Error HTTP 401"** → revisa que `ANTHROPIC_API_KEY` sea correcta en `.env`

**PDF sin texto** → el PDF puede ser una imagen escaneada (no compatible sin OCR)

**Puerto en uso** → cambia `PORT=3001` en `.env`
