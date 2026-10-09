'use strict';
// Pestañas, exportación de proyectos y de skills. Se carga después de sidepanel.js y reutiliza
// sus utilidades globales (estado, log, setEstado, setProgreso, enPagina, descargarActivo, volcarConversacion…).

const rec = { proyectos: [], skills: [] };

// ---------- pestañas ----------

function mostrarVista(vista) {
  for (const v of ['chat', 'proyectos', 'skills']) {
    $(`vista-${v}`).hidden = v !== vista;
    $(`tab-${v}`).setAttribute('aria-selected', String(v === vista));
  }
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => mostrarVista(t.dataset.vista)));

function bloquear(si) {
  document.querySelectorAll('button').forEach((b) => { if (!b.classList.contains('tab')) b.disabled = si; });
}

// ---------- contexto de consulta sobre la pestaña de la plataforma ----------

async function contexto() {
  const tab = await tabActiva();
  if (!tab || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || '')) throw new Error('Abre chatgpt.com en la pestaña activa y vuelve a intentarlo.');
  estado.tabId = tab.id;
  estado.origen = new URL(tab.url).origin;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-lib.js'] });
  return {
    tabId: tab.id, origin: estado.origen,
    consultar: (urls) => enPagina(tab.id, 'consultar', urls),
    binario: (urls) => enPagina(tab.id, 'binario', urls),
  };
}

// ---------- listas con casillas ----------

function renderSeleccion(contenedor, items, { conTipo = false } = {}) {
  contenedor.textContent = '';
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'sutil';
    p.textContent = 'No se encontró nada. Si crees que debería haber elementos, usa «Diagnosticar endpoints» en el registro.';
    contenedor.append(p);
    return;
  }
  const todo = document.createElement('label');
  todo.className = 'todo';
  const cbTodo = document.createElement('input');
  cbTodo.type = 'checkbox';
  cbTodo.checked = true;
  todo.append(cbTodo, document.createTextNode(`Seleccionar todo (${items.length})`));
  contenedor.append(todo);

  const checks = [];
  items.forEach((it, i) => {
    const label = document.createElement('label');
    label.className = 'item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.i = String(i);
    cb.checked = conTipo ? it.tipo === 'personal' : true; // los skills del proveedor no son tuyos: desmarcados
    checks.push(cb);
    const cuerpo = document.createElement('div');
    const nombre = document.createElement('div');
    nombre.className = 'nombre';
    nombre.textContent = it.nombre;
    if (conTipo || it.archivado) {
      const et = document.createElement('span');
      et.className = 'etiqueta';
      et.textContent = conTipo ? (it.tipo === 'personal' ? 'personal' : 'de OpenAI') : 'archivado';
      nombre.append(et);
    }
    cuerpo.append(nombre);
    if (it.descripcion) {
      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = it.descripcion.length > 160 ? it.descripcion.slice(0, 160) + '…' : it.descripcion;
      cuerpo.append(d);
    }
    label.append(cb, cuerpo);
    contenedor.append(label);
  });
  cbTodo.addEventListener('change', () => checks.forEach((c) => { c.checked = cbTodo.checked; }));
}

function seleccionados(contenedor, items) {
  return [...contenedor.querySelectorAll('.item input:checked')].map((c) => items[+c.dataset.i]);
}

function fechaCorta() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

// Evita rutas absolutas o con «..» al copiar archivos de un ZIP ajeno.
function rutaSegura(ruta) {
  const partes = String(ruta).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  return partes.length && !partes.includes('..') ? partes.join('/') : null;
}

// ---------- proyectos ----------

async function listarProyectos() {
  bloquear(true);
  setProgreso(0, 0);
  setEstado('Consultando tus proyectos…');
  try {
    const ctx = await contexto();
    const r = await Recursos.proyectos.listar(ctx);
    rec.proyectos = r.items;
    log(`Proyectos: ${rec.proyectos.length} (fuente: ${r.fuente.split('?')[0]}).`);
    renderSeleccion($('lista-proyectos'), rec.proyectos);
    $('btn-exportar-proyectos').hidden = !rec.proyectos.length;
    setEstado(rec.proyectos.length ? `${rec.proyectos.length} proyecto(s) encontrados.` : 'No se encontraron proyectos.');
  } catch (e) {
    log(`ERROR listando proyectos: ${e.message}`);
    setEstado(`No se pudieron listar los proyectos: ${e.message}`, true);
  } finally {
    setProgreso(0, null);
    bloquear(false);
  }
}

async function exportarProyectos() {
  const elegidos = seleccionados($('lista-proyectos'), rec.proyectos);
  if (!elegidos.length) { setEstado('Marca al menos un proyecto.', true); return; }
  const incluirConvs = $('opt-convs').checked;
  bloquear(true);
  const global = [];
  try {
    const origins = ['https://*/*']; // los archivos se sirven con URLs firmadas de otro dominio
    if (!(await chrome.permissions.contains({ origins }))) await chrome.permissions.request({ origins }); // gesto del clic
    const ctx = await contexto();
    const zip = new JSZip();
    const raiz = zip.folder(`proyectos_chatgpt_${fechaCorta()}`);
    const carpetas = new Set();

    for (let i = 0; i < elegidos.length; i++) {
      const item = elegidos[i];
      const etiquetaP = `Proyecto ${i + 1}/${elegidos.length} · `;
      setEstado(`${etiquetaP}${item.nombre}: leyendo…`);
      setProgreso(0, 0);
      const p = await Recursos.proyectos.cargar(ctx, item);
      const dir = raiz.folder(Core.nombreUnico(carpetas, Core.nombreSeguro(p.nombre, 60, 'proyecto')));
      const usados = new Set();

      if (p.instrucciones) dir.file('instrucciones.md', p.instrucciones);

      for (const d of p.docs) {
        d.ruta = Core.nombreUnico(usados, `conocimiento/${Core.nombreArchivoSeguro(d.nombre, 'documento')}`);
        dir.file(d.ruta, d.contenido);
      }
      for (const a of p.archivos) {
        if (!a.ref) { a.error = 'sin identificador de archivo'; p.errores.push(`«${a.nombre}»: sin identificador de archivo`); continue; }
        setEstado(`${etiquetaP}${item.nombre}: descargando ${a.nombre}…`);
        let candidatas;
        try {
          const res = await enPagina(ctx.tabId, 'resolverArchivo', a.ref, null);
          candidatas = [{ url: res.url, calidad: 'original' }];
          if (res.nombre && !Core.tieneExtension(a.nombre) && Core.tieneExtension(res.nombre)) a.nombre = res.nombre;
        } catch (e) { a.error = e.message; p.errores.push(`«${a.nombre}»: ${e.message}`); continue; }
        const r = await descargarActivo(ctx.tabId, candidatas, true);
        if (r.error) { a.error = r.error; p.errores.push(`«${a.nombre}»: ${r.error}`); continue; }
        let nombre = Core.nombreArchivoSeguro(a.nombre, 'archivo');
        if (!Core.tieneExtension(nombre)) { const ext = Core.extDesdeMime(r.tipo); if (ext) nombre += '.' + ext; }
        a.archivo = Core.nombreUnico(usados, `conocimiento/archivos/${nombre}`);
        dir.file(a.archivo, r.blob);
      }

      if (incluirConvs) {
        const usadasConv = new Set();
        for (let k = 0; k < p.conversaciones.length; k++) {
          const c = p.conversaciones[k];
          const etiqueta = `${etiquetaP}${item.nombre} · chat ${k + 1}/${p.conversaciones.length} · `;
          setEstado(`${etiqueta}leyendo…`);
          try {
            const r = await enPagina(ctx.tabId, 'fetchConversationApi', c.id);
            const conv = Core.normalizarApi(r.data);
            const sub = `conversaciones/${String(k + 1).padStart(2, '0')}_${Core.nombreUnico(usadasConv, Core.nombreSeguro(conv.titulo, 40, 'chat'))}`;
            const { informe } = await volcarConversacion(dir.folder(sub), conv, r.data, { etiqueta });
            c.carpeta = sub;
            informe.forEach((l) => p.errores.push(`chat «${conv.titulo}»: ${l}`));
          } catch (e) {
            p.errores.push(`chat «${c.titulo}»: ${e.message}`);
          }
        }
      }

      const { crudo, ...publico } = p;
      dir.file('proyecto.json', JSON.stringify({ exportado_en: new Date().toISOString(), ...publico }, null, 2));
      dir.file('debug/crudo.json', JSON.stringify(crudo, null, 2));
      dir.file('LEEME.md', Recursos.construirLeemeProyecto(p));
      dir.file('informe.txt', [`Proyecto «${p.nombre}»`, `Documentos: ${p.docs.length} · archivos: ${p.archivos.length} · conversaciones: ${p.conversaciones.length}${incluirConvs ? '' : ' (no incluidas)'}`, '', p.errores.length ? 'Incidencias:' : 'Sin incidencias.', ...p.errores.map((l) => `- ${l}`)].join('\n'));
      p.errores.forEach((l) => global.push(`${p.nombre}: ${l}`));
    }

    setEstado('Comprimiendo ZIP…');
    setProgreso(0, 0);
    descargarBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `proyectos_chatgpt_${fechaCorta()}.zip`);
    global.forEach((l) => log(`⚠️ ${l}`));
    setEstado(global.length ? `ZIP generado con ${global.length} incidencia(s); revisa el informe de cada proyecto.` : 'ZIP de proyectos generado sin incidencias.');
  } catch (e) {
    log(`ERROR exportando proyectos: ${e.message}`);
    setEstado(`Error al exportar proyectos: ${e.message}`, true);
  } finally {
    setProgreso(0, null);
    bloquear(false);
  }
}

// ---------- skills ----------

async function listarSkills() {
  bloquear(true);
  setProgreso(0, 0);
  setEstado('Consultando tus skills…');
  try {
    const ctx = await contexto();
    const r = await Recursos.skills.listar(ctx);
    rec.skills = r.items;
    log(`Skills: ${rec.skills.length} (fuente: ${r.fuente.split('?')[0]}).`);
    renderSeleccion($('lista-skills'), rec.skills, { conTipo: true });
    $('btn-exportar-skills').hidden = !rec.skills.length;
    setEstado(rec.skills.length ? `${rec.skills.length} skill(s) encontrados.` : 'No se encontraron skills.');
  } catch (e) {
    log(`ERROR listando skills: ${e.message}`);
    const todo404 = !/HTTP (?!404)\d+/.test(e.message) && /HTTP 404/.test(e.message);
    setEstado(
      `No se pudieron listar los skills: ${e.message}` +
      (todo404 ? ' — Todas las rutas respondieron 404: lo más probable es que tu plan no incluya Skills (solo Business, Enterprise, Edu y similares) o que ChatGPT use otra ruta. Usa «Diagnosticar endpoints» en el registro.' : ''),
      true
    );
  } finally {
    setProgreso(0, null);
    bloquear(false);
  }
}

async function exportarSkills() {
  const elegidos = seleccionados($('lista-skills'), rec.skills);
  if (!elegidos.length) { setEstado('Marca al menos un skill.', true); return; }
  bloquear(true);
  const global = [];
  try {
    const ctx = await contexto();
    const zip = new JSZip();
    const raiz = zip.folder(`skills_chatgpt_${fechaCorta()}`);
    const carpetas = new Set();
    const indice = ['# Skills exportados', ''];

    for (let i = 0; i < elegidos.length; i++) {
      const item = elegidos[i];
      setEstado(`Skill ${i + 1}/${elegidos.length}: ${item.nombre}…`);
      setProgreso(i, elegidos.length);
      const s = await Recursos.skills.cargar(ctx, item);
      const nombreDir = Core.nombreUnico(carpetas, Core.nombreSeguro(s.nombre, 60, 'skill'));
      const dir = raiz.folder(nombreDir);
      let contenido = 0;

      if (s.zipB64) {
        const bytes = await b64ABlob(s.zipB64, 'application/zip');
        dir.file(`${nombreDir}.zip`, bytes); // el ZIP original, listo para volver a subirlo
        try {
          const inner = await JSZip.loadAsync(bytes);
          for (const [ruta, f] of Object.entries(inner.files)) {
            const segura = rutaSegura(ruta);
            if (f.dir || !segura) continue;
            dir.file(segura, await f.async('blob'));
            contenido++;
          }
        } catch (e) { s.errores.push(`el ZIP descargado no se pudo abrir: ${e.message}`); }
      } else {
        for (const a of s.archivos) {
          const segura = rutaSegura(a.ruta);
          if (segura) { dir.file(segura, a.contenido); contenido++; }
        }
      }

      const { crudo, zipB64, ...publico } = s;
      dir.file('skill.json', JSON.stringify({ exportado_en: new Date().toISOString(), ...publico }, null, 2));
      dir.file('debug/crudo.json', JSON.stringify(crudo, null, 2));
      indice.push(`- **${s.nombre}** (${s.tipo}) — ${contenido} archivo(s)${s.errores.length ? ' ⚠️ ' + s.errores.join('; ') : ''}`);
      s.errores.forEach((l) => global.push(`${s.nombre}: ${l}`));
    }

    raiz.file('INDICE.md', indice.join('\n') + '\n');
    setEstado('Comprimiendo ZIP…');
    setProgreso(0, 0);
    descargarBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `skills_chatgpt_${fechaCorta()}.zip`);
    global.forEach((l) => log(`⚠️ ${l}`));
    setEstado(global.length ? `ZIP generado con ${global.length} incidencia(s); revisa INDICE.md.` : 'ZIP de skills generado sin incidencias.');
  } catch (e) {
    log(`ERROR exportando skills: ${e.message}`);
    setEstado(`Error al exportar skills: ${e.message}`, true);
  } finally {
    setProgreso(0, null);
    bloquear(false);
  }
}

// ---------- diagnóstico ----------

async function diagnosticar() {
  bloquear(true);
  setProgreso(0, 0);
  setEstado('Sondeando endpoints…');
  try {
    const ctx = await contexto();
    const urls = Recursos.urlsDiagnostico(ctx.org, {
      proyectoId: rec.proyectos[0] && rec.proyectos[0].id,
      skillId: rec.skills[0] && rec.skills[0].id,
    });
    const resultado = await enPagina(ctx.tabId, 'diagnostico', urls);
    const texto = JSON.stringify({ generado_en: new Date().toISOString(), version: VERSION, resultado }, null, 2);
    log('Diagnóstico (solo estados y forma de las respuestas, sin contenido):\n' + texto);
    descargarBlob(new Blob([texto], { type: 'application/json' }), 'diagnostico_chatgpt.json');
    setEstado('Diagnóstico descargado (diagnostico_chatgpt.json).');
  } catch (e) {
    log(`ERROR diagnóstico: ${e.message}`);
    setEstado(e.message, true);
  } finally {
    setProgreso(0, null);
    bloquear(false);
  }
}

$('btn-listar-proyectos').addEventListener('click', listarProyectos);
$('btn-exportar-proyectos').addEventListener('click', exportarProyectos);
$('btn-listar-skills').addEventListener('click', listarSkills);
$('btn-exportar-skills').addEventListener('click', exportarSkills);
$('btn-diag').addEventListener('click', diagnosticar);
