// Se inyecta en la pestaña de ChatGPT (mundo aislado). Expone globalThis.__EXPORTAR_CHATGPT__;
// el panel lateral invoca cada función con executeScript. Todo selector o texto de interfaz
// que dependa de la UI de ChatGPT vive en CFG, para tener un único sitio que ajustar.
(() => {
  'use strict';

  const CFG = {
    scrollMaxIter: 80,
    scrollWaitMs: 600,
    sel: {
      mensaje: '[data-message-author-role]',
      excluir: 'form, fieldset, textarea, [contenteditable="true"]',
    },
    reTipoArchivo: /\b(pdf|csv|txt|docx?|xlsx?|pptx?|json|md|zip)\b/i,
    reTamano: /\b\d+(?:[.,]\d+)?\s?(?:kb|mb)\b/i,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- API interna (requiere el token de la sesión) ----------

  let tokenCache = null;

  async function token() {
    if (tokenCache) return tokenCache;
    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status} en /api/auth/session`);
    const j = await res.json();
    if (!j || !j.accessToken) throw new Error('Sin sesión activa: no hay accessToken. Inicia sesión en ChatGPT.');
    tokenCache = j.accessToken;
    return tokenCache;
  }

  async function cabeceras() {
    const h = { accept: 'application/json', Authorization: `Bearer ${await token()}` };
    const did = document.cookie.match(/(?:^|;\s*)oai-did=([^;]+)/);
    if (did) h['oai-device-id'] = decodeURIComponent(did[1]);
    return h;
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'include', headers: await cabeceras() });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url.split('?')[0]}`);
    return res.json();
  }

  function idConversacion() {
    const m = location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }

  async function fetchConversationApi(idParam) {
    const id = idParam || idConversacion();
    if (!id) throw new Error('La pestaña activa no es una conversación (/c/<id>).');
    const data = await getJson(`/backend-api/conversation/${id}`);
    if (!data || typeof data.mapping !== 'object') throw new Error('Respuesta sin «mapping»');
    if (!data.conversation_id) data.conversation_id = id;
    return { data };
  }

  // Convierte una referencia de archivo (subido, generado o de la sandbox) en una URL firmada.
  async function resolverArchivo(ref, convId) {
    const intentos = [];
    if (ref.tipo === 'sandbox') {
      if (!convId) throw new Error('los archivos de la sandbox requieren la conversación');
      intentos.push(`/backend-api/conversation/${convId}/interpreter/download?message_id=${encodeURIComponent(ref.mensaje)}&sandbox_path=${encodeURIComponent(ref.ruta)}`);
    } else {
      const id = encodeURIComponent(ref.id);
      intentos.push(`/backend-api/files/${id}/download`);
      if (convId) {
        intentos.push(
          `/backend-api/files/download/${id}?conversation_id=${convId}&inline=false`,
          `/backend-api/conversation/${convId}/attachment/${id}/download`
        );
      }
    }
    const errores = [];
    for (const u of intentos) {
      try {
        const j = await getJson(u);
        const url = j.download_url || j.url;
        if (url) return { url: new URL(url, location.origin).href, nombre: j.file_name || null };
        const resumen = JSON.stringify(j).slice(0, 200);
        errores.push(`respuesta sin download_url: ${resumen}`);
      } catch (e) { errores.push(e.message); }
    }
    throw new Error([...new Set(errores)].join('; '));
  }

  // ---------- proyectos y skills: primitivas de consulta ----------

  async function consultar(urls) {
    const errores = [];
    for (const url of urls) {
      try { return { url, data: await getJson(url) }; } catch (e) { errores.push(e.message); }
    }
    throw new Error([...new Set(errores)].join('; '));
  }

  const esZip = (bytes) => bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);

  // Primera URL que devuelve un ZIP (por cabecera «PK»); null si ninguna.
  async function binario(urls) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: 'include', headers: await cabeceras() });
        if (!res.ok) continue;
        const blob = await res.blob();
        const bytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
        if (!esZip(bytes)) continue;
        const b64 = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(blob);
        });
        return { url, type: blob.type, b64 };
      } catch (e) { /* siguiente */ }
    }
    return null;
  }

  function forma(v, prof = 0) {
    if (Array.isArray(v)) return v.length ? [`array(${v.length})`, forma(v[0], prof + 1)] : ['array(0)'];
    if (v && typeof v === 'object') {
      if (prof >= 2) return '{…}';
      return Object.fromEntries(Object.entries(v).slice(0, 25).map(([k, x]) => [k, forma(x, prof + 1)]));
    }
    return typeof v;
  }

  // Para afinar endpoints: estado HTTP y *forma* (claves y tipos, nunca valores) de cada ruta.
  async function diagnostico(urls) {
    const out = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: 'include', headers: await cabeceras() });
        const tipo = res.headers.get('content-type') || '';
        const item = { url: url.replace(/g-p-[0-9a-f]+|[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>'), estado: res.status, tipo };
        if (res.ok && /json/i.test(tipo)) item.forma = forma(await res.json());
        out.push(item);
      } catch (e) { out.push({ url, error: String((e && e.message) || e) }); }
    }
    return out;
  }

  // ---------- descarga binaria (desde la página, con la sesión) ----------

  async function fetchBinary(url) {
    try {
      const u = new URL(url, location.href);
      const init = { credentials: u.origin === location.origin ? 'include' : 'omit' };
      if (u.origin === location.origin && u.pathname.startsWith('/backend-api')) init.headers = await cabeceras();
      const res = await fetch(u.href, init);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const blob = await res.blob();
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
      return { ok: true, type: blob.type || res.headers.get('content-type') || '', size: blob.size, b64 };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  // ---------- respaldo: lectura del DOM ----------

  function contenedorScroll() {
    const cands = [...document.querySelectorAll('main, main *')].filter((el) => {
      if (el.scrollHeight <= el.clientHeight + 40) return false;
      const o = getComputedStyle(el).overflowY;
      return o === 'auto' || o === 'scroll' || o === 'overlay';
    });
    cands.sort((a, b) => b.scrollHeight - a.scrollHeight);
    return cands[0] || document.scrollingElement;
  }

  // Sube hasta que deja de cargar historial, para no exportar solo lo visible.
  async function scrollToTop() {
    const el = contenedorScroll();
    let estable = 0;
    let prev = -1;
    let iter = 0;
    while (iter++ < CFG.scrollMaxIter && estable < 3) {
      el.scrollTop = 0;
      await sleep(CFG.scrollWaitMs);
      if (el.scrollHeight === prev && el.scrollTop === 0) estable++; else estable = 0;
      prev = el.scrollHeight;
    }
    el.scrollTop = el.scrollHeight;
    return { iteraciones: iter - 1, altura: prev };
  }

  function htmlToText(root) {
    const out = [];
    const SALTAR = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'SVG', 'IMG', 'NOSCRIPT']);
    function celdas(tr) {
      return [...tr.children].map((c) => (c.innerText || '').trim().replace(/\s*\n\s*/g, ' ')).join(' | ');
    }
    function walk(n, enPre) {
      if (n.nodeType === 3) { out.push(enPre ? n.nodeValue : n.nodeValue.replace(/\s+/g, ' ')); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toUpperCase();
      if (SALTAR.has(tag)) return;
      if (tag === 'PRE') {
        const code = n.querySelector('code');
        const lang = ((code && code.className.match(/language-([\w+-]+)/)) || [])[1] || '';
        out.push('\n\n```' + lang + '\n' + (code || n).textContent.replace(/\n$/, '') + '\n```\n\n');
        return;
      }
      if (tag === 'TR') { out.push('\n| ' + celdas(n) + ' |'); return; }
      if (tag === 'BR') { out.push('\n'); return; }
      if (tag === 'HR') { out.push('\n\n---\n\n'); return; }
      if (/^H[1-6]$/.test(tag)) { out.push('\n\n' + '#'.repeat(+tag[1]) + ' '); n.childNodes.forEach((c) => walk(c, false)); out.push('\n\n'); return; }
      if (tag === 'LI') {
        const ol = n.parentElement && n.parentElement.tagName === 'OL';
        const i = ol ? [...n.parentElement.children].indexOf(n) + 1 : 0;
        out.push('\n' + (ol ? i + '. ' : '- '));
        n.childNodes.forEach((c) => walk(c, false));
        return;
      }
      if (tag === 'A' && /^https?:/i.test(n.getAttribute('href') || '')) {
        out.push('[');
        n.childNodes.forEach((c) => walk(c, false));
        out.push(`](${n.getAttribute('href')})`);
        return;
      }
      if (tag === 'STRONG' || tag === 'B') { out.push('**'); n.childNodes.forEach((c) => walk(c, false)); out.push('**'); return; }
      if (tag === 'EM' || tag === 'I') { out.push('*'); n.childNodes.forEach((c) => walk(c, false)); out.push('*'); return; }
      if (tag === 'CODE') { out.push('`' + n.textContent + '`'); return; }
      const bloque = ['P', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE'].includes(tag);
      if (bloque) out.push('\n\n'); else if (tag === 'DIV') out.push('\n');
      n.childNodes.forEach((c) => walk(c, enPre));
      if (bloque) out.push('\n\n'); else if (tag === 'DIV') out.push('\n');
    }
    const preInicial = root.classList.contains('whitespace-pre-wrap') || /^pre/.test(getComputedStyle(root).whiteSpace);
    walk(root, preInicial);
    return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function esDocChip(el) {
    const t = (el.innerText || '').trim();
    return !!t && t.length < 120 && (CFG.reTipoArchivo.test(t) || CFG.reTamano.test(t));
  }

  function esImagenValida(img) {
    const src = img.currentSrc || img.src || '';
    if (!src || /avatar|profile|favicon/i.test(src)) return false;
    if ((img.naturalWidth && img.naturalWidth < 24) || (img.width && img.width < 24)) return false;
    const padre = img.closest('button, [role="button"], a');
    return !(padre && esDocChip(padre)); // miniaturas de documentos no son imágenes
  }

  function extractDom() {
    const nodos = [...document.querySelectorAll(CFG.sel.mensaje)].filter((n) => !n.closest(CFG.sel.excluir));
    const imagenesVistas = new Set();
    const mensajes = [];

    for (const nodo of nodos) {
      const atributo = nodo.getAttribute('data-message-author-role');
      if (atributo !== 'user' && atributo !== 'assistant') continue;
      const esUsuario = atributo === 'user';
      const rol = esUsuario ? 'Usuario' : 'ChatGPT';
      const texto = htmlToText(nodo.querySelector('.markdown') || nodo.querySelector('.whitespace-pre-wrap') || nodo);
      const turno = nodo.closest('article') || nodo.parentElement || nodo;

      const imagenes = [];
      for (const img of turno.querySelectorAll('img')) {
        if (img.closest(CFG.sel.excluir) || !esImagenValida(img)) continue;
        const url = img.currentSrc || img.src;
        if (imagenesVistas.has(url)) continue;
        imagenesVistas.add(url);
        imagenes.push({ url, alt: (img.alt || '').trim() || null });
      }

      const adjuntos = [];
      if (esUsuario) {
        for (const b of turno.querySelectorAll('button, [role="button"], a')) {
          if (b.closest(CFG.sel.excluir) || nodo.contains(b) || !esDocChip(b)) continue;
          const nombre = (b.innerText || '').split('\n')[0].trim();
          if (nombre && !adjuntos.includes(nombre)) adjuntos.push(nombre);
        }
      }

      if (!texto && !imagenes.length && !adjuntos.length) continue;
      const ult = mensajes[mensajes.length - 1];
      // Varios bloques consecutivos del asistente son un mismo turno; los del usuario no se funden.
      if (ult && ult.rol === 'ChatGPT' && rol === 'ChatGPT') {
        ult.texto = [ult.texto, texto].filter(Boolean).join('\n\n');
        ult.imagenes.push(...imagenes);
      } else {
        mensajes.push({ rol, texto, imagenes, adjuntos });
      }
    }
    const m = location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    return {
      id: m ? m[1] : null,
      titulo: document.title.replace(/\s*[-|–]\s*ChatGPT\s*$/i, '').trim(),
      url: location.href,
      mensajes,
    };
  }

  globalThis.__EXPORTAR_CHATGPT__ = {
    fetchConversationApi, resolverArchivo, fetchBinary, scrollToTop, extractDom,
    consultar, binario, diagnostico,
  };
})();
