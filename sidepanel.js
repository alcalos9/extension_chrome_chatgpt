'use strict';

const VERSION = '1.0.0';
const $ = (id) => document.getElementById(id);

const estado = { conv: null, raw: null, tabId: null, origen: 'https://chatgpt.com' };

// ---------- utilidades de UI ----------

function log(msg) {
  $('log').textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
}

function setEstado(msg, esError = false) {
  const el = $('estado');
  el.textContent = msg;
  el.classList.toggle('error', esError);
}

function setProgreso(hecho, total) {
  const p = $('progreso');
  if (total == null) { p.hidden = true; return; }
  p.hidden = false;
  if (total === 0) { p.removeAttribute('value'); return; }
  p.max = total;
  p.value = hecho;
}

function ocupado(si) {
  for (const id of ['btn-capturar', 'btn-exportar']) $(id).disabled = si;
}

// ---------- puente con la página ----------

async function tabActiva() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// Ejecuta una función de page-lib.js en la pestaña y devuelve su valor (o lanza su error).
async function enPagina(tabId, nombre, ...args) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (fn, a) => {
      try {
        return { ok: true, valor: await globalThis.__EXPORTAR_CHATGPT__[fn](...a) };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    args: [nombre, args],
  });
  if (!res || !res.result) throw new Error('La página no respondió (¿se recargó o cambió de pestaña?).');
  if (!res.result.ok) throw new Error(res.result.error);
  return res.result.valor;
}

async function b64ABlob(b64, tipo) {
  const r = await fetch(`data:${tipo || 'application/octet-stream'};base64,${b64}`);
  return r.blob();
}

function esMismoOrigen(url) {
  try { return new URL(url).origin === estado.origen; } catch (e) { return false; }
}

// Los archivos se sirven con URLs firmadas de otro dominio: se pide permiso solo si hay archivos.
async function permisoHostsExternos(conv) {
  const hayExternos = conv.mensajes.some((m) => m.adjuntos.some((a) => a.ref || a.urls.some((u) => /^https?:/i.test(u.url) && !esMismoOrigen(u.url))));
  if (!hayExternos) return;
  const origins = ['https://*/*'];
  if (await chrome.permissions.contains({ origins })) return;
  const ok = await chrome.permissions.request({ origins });
  log(ok ? 'Permiso concedido para descargar archivos de dominios externos.' : 'Permiso denegado: los archivos alojados fuera de chatgpt.com no se descargarán.');
}

// Primero desde la página (cookies de sesión garantizadas); si falla, desde la extensión.
async function descargarActivo(tabId, candidatas, permitirHtml) {
  const errores = [];
  for (const c of candidatas) {
    let blob = null;
    const mismoOrigen = esMismoOrigen(c.url);
    if (mismoOrigen || /^(blob|data):/i.test(c.url)) {
      try {
        const r = await enPagina(tabId, 'fetchBinary', c.url);
        if (r.ok) blob = await b64ABlob(r.b64, r.type);
        else errores.push(r.error);
      } catch (e) { errores.push(e.message); }
    }

    if (!blob) {
      try {
        // Hosts externos: requieren el permiso opcional y no deben recibir cookies de ChatGPT.
        const res = await fetch(c.url, { credentials: mismoOrigen ? 'include' : 'omit' });
        if (res.ok) blob = await res.blob(); else errores.push(`HTTP ${res.status}`);
      } catch (e) { errores.push(e.message); }
    }

    if (blob && !permitirHtml && /text\/html/i.test(blob.type)) {
      errores.push('la respuesta era HTML (¿sesión caducada?)');
      continue;
    }
    if (blob) return { blob, tipo: blob.type, candidata: c };
  }
  return { error: [...new Set(errores)].join('; ') || 'sin URL disponible' };
}

// ---------- captura ----------

function renderConversacion(conv) {
  const cont = $('mensajes');
  cont.textContent = '';
  let nAdj = 0;
  for (const m of conv.mensajes) {
    const div = document.createElement('div');
    div.className = `msg ${m.rol === Core.ROL_USUARIO ? 'usuario' : 'asistente'}`;
    const rol = document.createElement('div');
    rol.className = 'rol';
    rol.textContent = `${m.rol} · #${m.indice}`;
    const txt = document.createElement('div');
    txt.textContent = m.texto;
    div.append(rol, txt);
    if (m.adjuntos.length) {
      const adj = document.createElement('div');
      adj.className = 'adj';
      adj.textContent = m.adjuntos.map((a) => `${a.clase === 'imagen' ? '🖼️' : '📎'} ${a.nombre}`).join('  ·  ');
      div.append(adj);
      nAdj += m.adjuntos.length;
    }
    cont.append(div);
  }
  const u = conv.mensajes.filter((m) => m.rol === Core.ROL_USUARIO).length;
  const imgs = conv.mensajes.reduce((n, m) => n + m.adjuntos.filter((a) => a.clase === 'imagen').length, 0);
  const gen = conv.mensajes.reduce((n, m) => n + m.adjuntos.filter((a) => a.origen === 'generada').length, 0);
  $('resumen').textContent =
    `${conv.mensajes.length} mensajes (${u} del usuario, ${conv.mensajes.length - u} de ChatGPT) · ` +
    `${imgs} imágenes${gen ? ` (${gen} generadas)` : ''} · ${nAdj - imgs} documentos · origen: ${conv.origen === 'api' ? 'API de la conversación' : 'lectura del DOM'}`;
}

async function capturar() {
  ocupado(true);
  estado.conv = null;
  estado.raw = null;
  $('mensajes').textContent = '';
  $('resumen').textContent = '';
  $('btn-exportar').hidden = true;
  try {
    const tab = await tabActiva();
    if (!tab || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || '')) {
      throw new Error('Abre una conversación en chatgpt.com y vuelve a intentarlo.');
    }
    estado.tabId = tab.id;
    estado.origen = new URL(tab.url).origin;
    $('pestana').textContent = tab.title || tab.url;
    setProgreso(0, 0);
    setEstado('Leyendo la conversación…');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-lib.js'] });

    let conv = null;
    try {
      const r = await enPagina(tab.id, 'fetchConversationApi');
      estado.raw = r.data;
      conv = Core.normalizarApi(r.data);
      log(`API: ${conv.mensajes.length} mensajes en la rama activa (${conv.mensajes_en_arbol} en el árbol).`);
    } catch (e) {
      log(`API no disponible (${e.message}); se usa la lectura del DOM.`);
    }

    if (!conv || !conv.mensajes.length) {
      setEstado('Cargando el historial completo (desplazando al inicio)…');
      const s = await enPagina(tab.id, 'scrollToTop');
      log(`Scroll: ${s.iteraciones} iteraciones.`);
      const raw = await enPagina(tab.id, 'extractDom');
      conv = Core.normalizarDom(raw);
      log(`DOM: ${conv.mensajes.length} mensajes.`);
    }

    if (!conv.mensajes.length) throw new Error('No se detectaron mensajes en la conversación.');
    estado.conv = conv;
    renderConversacion(conv);
    $('btn-exportar').hidden = false;
    setEstado(`Conversación capturada: «${conv.titulo}».`);
  } catch (e) {
    log(`ERROR captura: ${e.message}`);
    setEstado(e.message, true);
  } finally {
    setProgreso(0, null);
    ocupado(false);
  }
}

// ---------- exportación ----------

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
}

async function exportar() {
  ocupado(true);
  const conv = estado.conv;
  const informe = [];
  try {
    await permisoHostsExternos(conv); // primero: requiere el gesto del clic
    const base = Core.nombreSeguro(conv.titulo);
    const zip = new JSZip();
    const raiz = zip.folder(base);
    const usados = new Set();
    const prefijo = (m) => `msg${String(m.indice).padStart(3, '0')}_${m.rol === Core.ROL_USUARIO ? 'usuario' : 'chatgpt'}`;

    const tareas = conv.mensajes.reduce((n, m) => n + m.adjuntos.filter((a) => a.urls.length || a.ref).length, 0);
    let hechas = 0;
    setProgreso(0, tareas);

    for (const m of conv.mensajes) {
      for (const a of m.adjuntos) {
        const carpeta = a.clase === 'imagen' ? 'imagenes' : 'archivos';
        let candidatas = a.urls;

        if (!candidatas.length && !a.ref) {
          a.error = 'sin enlace de descarga (solo se conoce el nombre)';
          informe.push(`Mensaje ${m.indice}: «${a.nombre}» sin enlace de descarga.`);
          continue;
        }

        setEstado(`Descargando ${a.nombre} (${++hechas}/${tareas})…`);
        setProgreso(hechas, tareas);

        let nombreResuelto = null;
        if (a.ref) {
          try {
            const res = await enPagina(estado.tabId, 'resolverArchivo', a.ref, conv.id);
            candidatas = [{ url: res.url, calidad: 'original' }, ...candidatas];
            nombreResuelto = res.nombre;
          } catch (e) {
            a.error = `no se pudo obtener el enlace: ${e.message}`;
            informe.push(`Mensaje ${m.indice}: «${a.nombre}» → ${e.message}`);
            continue;
          }
        }
        if (nombreResuelto && !Core.tieneExtension(a.nombre) && Core.tieneExtension(nombreResuelto)) a.nombre = nombreResuelto;
        const nombreBase = Core.nombreArchivoSeguro(a.nombre, a.clase);

        const r = await descargarActivo(estado.tabId, candidatas, /\.html?$/i.test(a.nombre));
        if (r.error) {
          a.error = `no se pudo descargar: ${r.error}`;
          informe.push(`Mensaje ${m.indice}: «${a.nombre}» → ${r.error}`);
          continue;
        }
        let nombre = nombreBase;
        if (!Core.tieneExtension(nombre)) {
          const ext = Core.extDesdeMime(r.tipo);
          if (ext) nombre += '.' + ext;
        }
        const ruta = Core.nombreUnico(usados, `${carpeta}/${prefijo(m)}_${nombre}`);
        raiz.file(ruta, r.blob);
        a.archivo = ruta;
        a.tipo = a.tipo || r.tipo || null;
      }
    }

    conv.archivos_sin_asignar = [];
    setEstado('Generando archivos…');

    const json = { exportado_en: new Date().toISOString(), version_extension: VERSION, ...conv };
    if (estado.raw) raiz.file('debug/api_raw.json', JSON.stringify(estado.raw, null, 2));
    raiz.file('conversacion.json', JSON.stringify(json, null, 2));
    raiz.file('conversacion.md', Core.construirMarkdown(conv, { incluirRazonamiento: $('opt-razonamiento').checked }));

    const nImg = conv.mensajes.reduce((n, m) => n + m.adjuntos.filter((a) => a.clase === 'imagen' && a.archivo).length, 0);
    const nDoc = conv.mensajes.reduce((n, m) => n + m.adjuntos.filter((a) => a.clase === 'documento' && a.archivo).length, 0);
    raiz.file('informe.txt', [
      `Exportación de «${conv.titulo}» (${new Date().toLocaleString()})`,
      `Mensajes: ${conv.mensajes.length} · imágenes guardadas: ${nImg} · documentos guardados: ${nDoc}`,
      `Origen de los datos: ${conv.origen}`,
      '',
      informe.length ? 'Incidencias:' : 'Sin incidencias.',
      ...informe.map((l) => `- ${l}`),
    ].join('\n'));

    setEstado('Comprimiendo ZIP…');
    setProgreso(0, 0);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    descargarBlob(blob, `${base}.zip`);
    informe.forEach((l) => log(`⚠️ ${l}`));
    setEstado(informe.length ? `ZIP generado con ${informe.length} incidencia(s); revisa informe.txt.` : 'ZIP generado sin incidencias.');
  } catch (e) {
    log(`ERROR exportación: ${e.message}`);
    setEstado(`Error al exportar: ${e.message}`, true);
  } finally {
    setProgreso(0, null);
    ocupado(false);
  }
}

$('btn-capturar').addEventListener('click', capturar);
$('btn-exportar').addEventListener('click', exportar);
