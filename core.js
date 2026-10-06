// Lógica pura (sin chrome.* ni DOM): normaliza la conversación venga de la API interna de
// ChatGPT o del DOM, y genera Markdown / nombres de archivo. Pruebas: `node tests/core.test.js`.
(function (root) {
  'use strict';

  const ROL_USUARIO = 'Usuario';
  const ROL_ASISTENTE = 'ChatGPT';

  // ---------- nombres de archivo ----------

  function quitarAcentos(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function nombreSeguro(s, max = 60, fallback = 'chat') {
    const t = quitarAcentos(s)
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, max)
      .replace(/_+$/, '');
    return t || fallback;
  }

  // Conserva mayúsculas y extensión; solo neutraliza caracteres problemáticos.
  function nombreArchivoSeguro(nombre, fallback = 'archivo') {
    const base = String(nombre || '').split(/[\\/]/).pop();
    const m = base.match(/^(.*)\.([A-Za-z0-9]{1,6})$/);
    const stem = m ? m[1] : base;
    const ext = m ? m[2].toLowerCase() : '';
    const limpio = quitarAcentos(stem).replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    return (limpio || fallback) + (ext ? '.' + ext : '');
  }

  function nombreUnico(usados, ruta) {
    if (!usados.has(ruta)) { usados.add(ruta); return ruta; }
    const m = ruta.match(/^(.*?)(\.[A-Za-z0-9]{1,6})?$/);
    for (let i = 2; ; i++) {
      const candidata = `${m[1]}_${i}${m[2] || ''}`;
      if (!usados.has(candidata)) { usados.add(candidata); return candidata; }
    }
  }

  const MIME_EXT = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif', 'image/heic': 'heic',
    'application/pdf': 'pdf', 'text/csv': 'csv', 'text/plain': 'txt', 'text/markdown': 'md',
    'application/json': 'json', 'text/html': 'html',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  };

  function extDesdeMime(mime) {
    return MIME_EXT[String(mime || '').split(';')[0].trim().toLowerCase()] || '';
  }

  function tieneExtension(nombre) {
    return /\.[A-Za-z0-9]{1,6}$/.test(nombre || '');
  }

  // ---------- normalización: API interna de ChatGPT ----------
  //
  // GET /backend-api/conversation/<id> devuelve un árbol `mapping` (nodo → {parent, children, message})
  // y `current_node` (la hoja de la rama visible). Un "turno" del asistente en la interfaz agrupa varios
  // nodos (llamadas a herramientas, resultados, imágenes generadas, respuesta final): aquí se fusionan.

  function aIso(t) {
    return typeof t === 'number' && isFinite(t) ? new Date(t * 1000).toISOString() : null;
  }

  // Marcadores de citas / entidades que ChatGPT inserta en el texto (caracteres de uso privado).
  function limpiarTexto(t) {
    return String(t || '')
      .replace(/entity\[\s*"[^"]*"\s*,\s*"([^"]*)"[\s\S]*?/g, '$1')
      .replace(/[\s\S]*?/g, '')
      .replace(/【[^】]*】/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function idDePuntero(ptr) {
    return String(ptr || '').replace(/^[a-z-]+:\/\//i, '');
  }

  function hojaDe(mapping, actual) {
    if (actual && mapping[actual]) return actual;
    let mejor = null;
    for (const [id, n] of Object.entries(mapping)) {
      if (n.children && n.children.length) continue;
      const t = (n.message && n.message.create_time) || 0;
      if (!mejor || t > mejor.t) mejor = { id, t };
    }
    return mejor && mejor.id;
  }

  function cadenaActual(mapping, hoja) {
    const nodos = [];
    const vistos = new Set();
    let id = hoja;
    while (id && mapping[id] && !vistos.has(id)) {
      vistos.add(id);
      nodos.push(mapping[id]);
      id = mapping[id].parent;
    }
    return nodos.reverse();
  }

  function nuevoAdjunto(clase, id, nombre, tipo, tamano, extra) {
    return Object.assign({
      clase, id: id || null, nombre, tipo: tipo || null, tamano: tamano != null ? tamano : null,
      urls: [], ref: id ? { tipo: 'file', id } : null, texto_extraido: null,
    }, extra || {});
  }

  function enlacesSandbox(texto, idMensaje) {
    const rutas = new Set();
    const re = /sandbox:(\/[^\s)\]>"']+)/g;
    let m;
    while ((m = re.exec(texto))) rutas.add(m[1]);
    return [...rutas].map((ruta) => {
      let nombre = ruta.split('/').pop();
      try { nombre = decodeURIComponent(nombre); } catch (e) { /* se deja tal cual */ }
      const a = nuevoAdjunto('documento', null, nombre, null, null, { origen: 'sandbox' });
      a.ref = { tipo: 'sandbox', ruta, mensaje: idMensaje };
      return a;
    });
  }

  function procesarMensaje(m, nodoId) {
    const rol = (m.author && m.author.role) || '';
    const c = m.content || {};
    const tipo = c.content_type;
    const salida = { texto: '', bloques: [], adjuntos: [] };
    const idMsg = m.id || nodoId;
    const llamadaHerramienta = rol === 'assistant' && m.recipient && m.recipient !== 'all';

    if (tipo === 'text' || tipo === 'multimodal_text') {
      const textos = [];
      for (const p of c.parts || []) {
        if (typeof p === 'string') textos.push(p);
        else if (p && p.content_type === 'image_asset_pointer') {
          const id = idDePuntero(p.asset_pointer);
          salida.adjuntos.push(nuevoAdjunto('imagen', id, `imagen_${id}`, 'image', p.size_bytes, { origen: rol === 'tool' ? 'generada' : null }));
        }
      }
      const texto = limpiarTexto(textos.join('\n'));
      if (llamadaHerramienta) {
        if (texto) salida.bloques.push({ tipo: 'herramienta', nombre: m.recipient, entrada: { texto } });
      } else if (rol === 'tool') {
        if (texto) salida.bloques.push({ tipo: 'resultado_herramienta', nombre: (m.author && m.author.name) || null, texto });
      } else {
        salida.texto = texto;
      }
    } else if (tipo === 'code') {
      salida.bloques.push({ tipo: 'herramienta', nombre: m.recipient || c.language || 'codigo', entrada: { codigo: c.text || '' } });
    } else if (tipo === 'execution_output') {
      salida.bloques.push({ tipo: 'resultado_herramienta', nombre: 'python', texto: c.text || '' });
    } else if (tipo === 'thoughts') {
      const t = (c.thoughts || []).map((x) => [x.summary, x.content].filter(Boolean).join('\n')).join('\n\n');
      if (t) salida.bloques.push({ tipo: 'razonamiento', texto: t });
    } else if (tipo === 'reasoning_recap') {
      if (c.content) salida.bloques.push({ tipo: 'razonamiento', texto: c.content });
    } else if (tipo === 'tether_quote' || tipo === 'tether_browsing_display') {
      const t = c.text || c.result || '';
      if (t) salida.bloques.push({ tipo: 'resultado_herramienta', nombre: 'navegación', texto: String(t) });
    }

    // Adjuntos declarados en los metadatos (archivos subidos por el usuario o creados por el asistente).
    for (const at of (m.metadata && m.metadata.attachments) || []) {
      if (!at || !at.id) continue;
      const esImagen = /^image\//i.test(at.mime_type || '');
      const existente = salida.adjuntos.find((a) => a.id === at.id);
      if (existente) {
        existente.nombre = at.name || existente.nombre;
        existente.tipo = at.mime_type || existente.tipo;
        if (at.size != null) existente.tamano = at.size;
      } else {
        salida.adjuntos.push(nuevoAdjunto(esImagen ? 'imagen' : 'documento', at.id, at.name || at.id, at.mime_type, at.size));
      }
    }

    if (rol === 'assistant' && salida.texto) salida.adjuntos.push(...enlacesSandbox(salida.texto, idMsg));
    return salida;
  }

  function normalizarApi(raw, ctx = {}) {
    const mapping = (raw && raw.mapping) || {};
    const cadena = cadenaActual(mapping, hojaDe(mapping, raw.current_node));
    const mensajes = [];
    let turno = null;

    const cerrar = () => {
      if (!turno) return;
      turno.texto = turno.textos.join('\n\n').trim();
      delete turno.textos;
      mensajes.push(turno);
      turno = null;
    };
    const anadirAdjuntos = (destino, lista) => {
      for (const a of lista) {
        const dup = destino.adjuntos.find((x) =>
          (a.id && x.id === a.id) || (a.ref && a.ref.tipo === 'sandbox' && x.ref && x.ref.ruta === a.ref.ruta));
        if (!dup) destino.adjuntos.push(a);
      }
    };

    for (const nodo of cadena) {
      const m = nodo.message;
      if (!m) continue;
      const rol = m.author && m.author.role;
      if (rol === 'system' || (m.metadata && m.metadata.is_visually_hidden_from_conversation)) continue;
      if (m.content && m.content.content_type === 'user_editable_context') continue;

      const p = procesarMensaje(m, nodo.id);
      if (rol === 'user') {
        cerrar();
        mensajes.push({
          indice: 0, id: m.id || nodo.id, rol: ROL_USUARIO, fecha: aIso(m.create_time),
          texto: p.texto, bloques: p.bloques, adjuntos: p.adjuntos,
        });
      } else {
        if (!turno) {
          turno = { indice: 0, id: m.id || nodo.id, rol: ROL_ASISTENTE, fecha: aIso(m.create_time), textos: [], bloques: [], adjuntos: [] };
        }
        if (p.texto) turno.textos.push(p.texto);
        turno.bloques.push(...p.bloques);
        anadirAdjuntos(turno, p.adjuntos);
      }
    }
    cerrar();
    mensajes.forEach((m, i) => { m.indice = i + 1; });

    return {
      id: raw.conversation_id || raw.id || ctx.id || null,
      titulo: raw.title || 'Sin título',
      creada: aIso(raw.create_time),
      actualizada: aIso(raw.update_time),
      modelo: raw.default_model_slug || null,
      origen: 'api',
      mensajes_en_arbol: Object.keys(mapping).length,
      mensajes,
      archivos_sin_asignar: [],
    };
  }

  // ---------- normalización: lectura del DOM (respaldo) ----------

  function normalizarDom(raw) {
    const mensajes = (raw.mensajes || []).map((m, i) => {
      const adjuntos = [];
      (m.imagenes || []).forEach((img, k) => {
        adjuntos.push(nuevoAdjunto('imagen', null, img.alt || `imagen_${i + 1}_${k + 1}`, null, null, { urls: [{ url: img.url, calidad: 'original' }] }));
      });
      (m.adjuntos || []).forEach((nombre) => adjuntos.push(nuevoAdjunto('documento', null, nombre, null, null)));
      return {
        indice: i + 1, id: null, rol: m.rol === 'Usuario' ? ROL_USUARIO : ROL_ASISTENTE, fecha: null,
        texto: (m.texto || '').trim(), bloques: [], adjuntos,
      };
    });
    return {
      id: raw.id || null, titulo: raw.titulo || 'Sin título', creada: null, actualizada: null, modelo: null,
      origen: 'dom', mensajes_en_arbol: mensajes.length, mensajes, archivos_sin_asignar: [],
    };
  }

  // ---------- Markdown ----------

  function formatoTamano(n) {
    if (n == null || isNaN(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function fencia(texto, lenguaje) {
    const largo = Math.max(3, ...((texto.match(/`+/g) || []).map((s) => s.length + 1)));
    const f = '`'.repeat(largo);
    return `${f}${lenguaje || ''}\n${texto}\n${f}`;
  }

  function construirMarkdown(conv, opciones = {}) {
    const L = [];
    L.push(`# ${conv.titulo}`, '');
    if (conv.id) L.push(`- ID: \`${conv.id}\``);
    if (conv.modelo) L.push(`- Modelo: ${conv.modelo}`);
    if (conv.creada) L.push(`- Creada: ${conv.creada}`);
    if (conv.actualizada) L.push(`- Última actualización: ${conv.actualizada}`);
    L.push(`- Mensajes: ${conv.mensajes.length}`, '', '---', '');

    for (const m of conv.mensajes) {
      const icono = m.rol === ROL_USUARIO ? '👤' : '🤖';
      L.push(`## ${icono} ${m.rol} · #${m.indice}${m.fecha ? ' · ' + m.fecha : ''}`, '');

      if (m.adjuntos.length) {
        L.push('**Adjuntos:**', '');
        for (const a of m.adjuntos) {
          const meta = [a.tipo, formatoTamano(a.tamano)].filter(Boolean).join(', ');
          if (a.clase === 'imagen' && a.archivo) {
            L.push(`- 🖼️ ${a.nombre}${meta ? ' (' + meta + ')' : ''}${a.origen === 'generada' ? ' — generada' : ''}`, `  ![${a.nombre}](${encodeURI(a.archivo)})`);
          } else {
            const enlace = a.archivo ? ` — [archivo](${encodeURI(a.archivo)})` : '';
            L.push(`- ${a.clase === 'imagen' ? '🖼️' : '📎'} ${a.nombre}${meta ? ' (' + meta + ')' : ''}${enlace}${a.error ? ' ⚠️ ' + a.error : ''}`);
          }
        }
        L.push('');
      }

      if (opciones.incluirRazonamiento) {
        for (const b of m.bloques) {
          if (b.tipo === 'razonamiento') L.push('<details><summary>Razonamiento</summary>', '', b.texto, '', '</details>', '');
          else if (b.tipo === 'herramienta') L.push(`> 🔧 Herramienta \`${b.nombre}\`: ${JSON.stringify(b.entrada)}`, '');
          else if (b.tipo === 'resultado_herramienta') L.push('<details><summary>Resultado de herramienta</summary>', '', fencia(b.texto), '', '</details>', '');
        }
      }

      if (m.texto) L.push(m.texto, '');
      L.push('---', '');
    }
    return L.join('\n');
  }

  const api = {
    ROL_USUARIO, ROL_ASISTENTE, nombreSeguro, nombreArchivoSeguro, nombreUnico, extDesdeMime, tieneExtension,
    normalizarApi, normalizarDom, construirMarkdown, formatoTamano, limpiarTexto,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
