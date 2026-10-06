// Proyectos y skills de ChatGPT. Lógica pura: recibe un «contexto» (ctx) que sabe consultar la página:
//   ctx.origin
//   ctx.consultar(urls)  → { url, data }  (primera URL que responde JSON; lanza si ninguna)
//   ctx.binario(urls)    → { url, type, b64 } | null   (primera respuesta ZIP)
// Los endpoints internos no son públicos: cada operación prueba varias rutas y registra lo que falla
// en `errores`, y siempre conserva la respuesta cruda en `crudo` para poder ajustar el formato.
// Los proyectos de ChatGPT son «gizmos» internos (id g-p-…). Pruebas: `node tests/recursos.test.js`.
(function (root) {
  'use strict';

  const pick = (o, ...claves) => {
    for (const k of claves) if (o && o[k] != null && o[k] !== '') return o[k];
    return null;
  };

  function lista(data, claves) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const k of claves) if (Array.isArray(data[k])) return data[k];
    const arrays = Object.values(data).filter(Array.isArray);
    return arrays.length === 1 ? arrays[0] : [];
  }

  // Recorre una lista paginada por cursor (`?cursor=0`, luego el cursor devuelto) hasta agotarla.
  async function paginar(ctx, urlBase, claves, tope = 50) {
    const todos = [];
    let cursor = '0';
    for (let i = 0; i < tope; i++) {
      const sep = urlBase.includes('?') ? '&' : '?';
      const r = await ctx.consultar([`${urlBase}${sep}cursor=${encodeURIComponent(cursor)}`]);
      const items = lista(r.data, claves);
      todos.push(...items);
      cursor = r.data && r.data.cursor;
      if (!cursor || !items.length) break;
    }
    return todos;
  }

  // Archivo de un proyecto → mismo formato de «adjunto» que las conversaciones (se resuelve por referencia).
  function adjuntoDeArchivo(f) {
    const id = pick(f, 'file_id', 'id', 'file_uuid');
    const mime = pick(f, 'mime_type', 'type', 'file_type') || '';
    const esImagen = /^image\//i.test(mime);
    return {
      clase: esImagen ? 'imagen' : 'documento', id, nombre: pick(f, 'name', 'file_name', 'filename') || (id || 'archivo'),
      tipo: mime || null, tamano: pick(f, 'size', 'file_size', 'size_bytes'), urls: [],
      ref: id ? { tipo: 'file', id } : null, texto_extraido: null,
    };
  }

  // ---------- proyectos ----------

  const proyectos = {
    urlsLista: () => [
      '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&owned_only=true',
      '/backend-api/gizmos/snorlax/sidebar',
    ],

    normalizarLista(data) {
      return lista(data, ['items', 'projects', 'data', 'results'])
        .map((it) => {
          const g = (it && it.gizmo && it.gizmo.gizmo) || (it && it.gizmo) || it || {};
          const disp = g.display || {};
          return {
            id: pick(g, 'id'),
            nombre: pick(disp, 'name') || pick(g, 'name', 'title') || 'Sin nombre',
            descripcion: pick(disp, 'description') || pick(g, 'description') || '',
            archivado: !!pick(g, 'archived_at', 'is_archived'),
            creado: pick(g, 'created_at'),
            actualizado: pick(g, 'updated_at'),
            raw: it,
          };
        })
        .filter((p) => p.id);
    },

    async listar(ctx) {
      // La barra lateral también devuelve GPTs: aquí interesan los proyectos (id g-p-…) si se distinguen.
      const r = await ctx.consultar(this.urlsLista());
      let items = this.normalizarLista(r.data);
      const soloProyectos = items.filter((p) => /^g-p-/.test(p.id));
      if (soloProyectos.length) items = soloProyectos;
      return { fuente: r.url, items };
    },

    async cargar(ctx, item) {
      const base = `/backend-api/gizmos/${item.id}`;
      const out = {
        id: item.id, nombre: item.nombre, descripcion: item.descripcion || '', instrucciones: '',
        creado: item.creado || null, actualizado: item.actualizado || null,
        docs: [], archivos: [], conversaciones: [], errores: [], crudo: { lista: item.raw || null },
      };
      const intentar = async (etiqueta, fn) => {
        try { return await fn(); } catch (e) { out.errores.push(`${etiqueta}: ${e.message}`); return null; }
      };

      const det = await intentar('detalle del proyecto', () => ctx.consultar([base]));
      if (det) {
        out.crudo.detalle = det.data;
        const g = (det.data && det.data.gizmo) || det.data || {};
        out.instrucciones = pick(g, 'instructions') || pick(det.data, 'instructions') || '';
        out.descripcion = pick(g.display || {}, 'description') || pick(g, 'description') || out.descripcion;
        const archivos = lista(det.data && det.data.files, ['files']).length ? det.data.files : (Array.isArray(g.files) ? g.files : []);
        out.archivos = archivos.filter(Boolean).map(adjuntoDeArchivo);
      }

      const convs = await intentar('conversaciones del proyecto', () => paginar(ctx, `${base}/conversations`, ['items', 'conversations', 'data']));
      out.crudo.conversaciones = convs;
      out.conversaciones = (convs || []).map((c) => ({
        id: pick(c, 'id', 'conversation_id'), titulo: pick(c, 'title', 'name') || 'Sin título',
        creada: toIso(pick(c, 'create_time', 'created_at')), actualizada: toIso(pick(c, 'update_time', 'updated_at')),
      })).filter((c) => c.id);
      return out;
    },
  };

  function toIso(t) {
    if (typeof t === 'number' && isFinite(t)) return new Date(t * 1000).toISOString();
    return t || null;
  }

  // ---------- skills ----------

  function esDeOpenAI(s) {
    if (s.is_public === true || s.is_system === true || s.is_builtin === true) return true;
    return /openai|public|system|builtin|curated|example/i.test(String(pick(s, 'type', 'source', 'creator_type', 'visibility', 'scope', 'owner') || ''));
  }

  // Un skill es un ZIP/.skill con SKILL.md (+ archivos). Si el servidor no lo entrega, se reconstruye de los campos.
  function reconstruirArchivosSkill(obj, nombre, descripcion) {
    const candidatos = [obj, obj && obj.skill, obj && obj.latest_version, obj && obj.version, obj && obj.current_version].filter((x) => x && typeof x === 'object');
    for (const o of candidatos) {
      const files = ['files', 'contents', 'skill_files', 'file_contents'].map((k) => o[k]).find(Array.isArray);
      if (files) {
        const archivos = files
          .map((f) => ({ ruta: pick(f, 'path', 'name', 'file_name', 'filename'), contenido: pick(f, 'content', 'text', 'body') }))
          .filter((f) => f.ruta && typeof f.contenido === 'string');
        if (archivos.length) return archivos;
      }
      const md = pick(o, 'skill_md', 'skill_md_content', 'skill_markdown', 'instructions', 'content', 'body');
      if (typeof md === 'string' && md.trim()) {
        const conCabecera = /^---\s*\n[\s\S]*?\n---/.test(md)
          ? md
          : `---\nname: ${nombre}\ndescription: ${String(descripcion || '').replace(/\n/g, ' ')}\n---\n\n${md}`;
        return [{ ruta: 'SKILL.md', contenido: conCabecera }];
      }
    }
    return [];
  }

  const skills = {
    urlsLista: () => [
      '/backend-api/skills',
      '/backend-api/skills?limit=100',
      '/backend-api/skills/list',
      '/backend-api/user_skills',
    ],

    normalizarLista(data) {
      return lista(data, ['skills', 'items', 'data', 'results'])
        .map((s) => {
          const id = pick(s, 'skill_id', 'id', 'uuid', 'name');
          return {
            id,
            nombre: pick(s, 'name', 'display_name', 'title') || String(id || ''),
            descripcion: pick(s, 'description', 'summary') || '',
            tipo: esDeOpenAI(s) ? 'openai' : 'personal',
            habilitado: pick(s, 'enabled', 'is_enabled'),
            actualizado: pick(s, 'updated_at', 'created_at'),
            raw: s,
          };
        })
        .filter((s) => s.id);
    },

    async listar(ctx) {
      const r = await ctx.consultar(this.urlsLista());
      return { fuente: r.url, items: this.normalizarLista(r.data) };
    },

    async cargar(ctx, item) {
      const base = `/backend-api/skills/${encodeURIComponent(item.id)}`;
      const out = { id: item.id, nombre: item.nombre, descripcion: item.descripcion, tipo: item.tipo, zipB64: null, archivos: [], errores: [], crudo: { lista: item.raw || null } };

      try {
        const bin = await ctx.binario([`${base}/download`, `${base}/export`, `${base}/zip`]);
        if (bin) { out.zipB64 = bin.b64; out.crudo.zip = { url: bin.url, type: bin.type }; }
      } catch (e) { out.errores.push(`descarga del ZIP: ${e.message}`); }

      let detalle = null;
      try {
        const r = await ctx.consultar([base, `${base}/versions`, `${base}/files`]);
        detalle = r.data;
        out.crudo.detalle = r.data;
      } catch (e) { if (!out.zipB64) out.errores.push(`detalle del skill: ${e.message}`); }

      if (!out.zipB64) {
        out.archivos = reconstruirArchivosSkill(detalle, item.nombre, item.descripcion);
        if (!out.archivos.length) out.archivos = reconstruirArchivosSkill(item.raw, item.nombre, item.descripcion);
        if (!out.archivos.length) out.errores.push('no se encontró el contenido del skill (ni ZIP ni SKILL.md); solo se guardan sus metadatos');
      }
      return out;
    },
  };

  // ---------- documentos de salida ----------

  function construirLeemeProyecto(p) {
    const L = [`# ${p.nombre}`, ''];
    if (p.descripcion) L.push(p.descripcion, '');
    if (p.creado) L.push(`- Creado: ${p.creado}`);
    if (p.actualizado) L.push(`- Actualizado: ${p.actualizado}`);
    L.push('', '## Instrucciones del proyecto', '', p.instrucciones ? p.instrucciones : '_(sin instrucciones)_', '');
    L.push('## Conocimiento', '');
    if (!p.docs.length && !p.archivos.length) L.push('_(vacío)_');
    p.docs.forEach((d) => L.push(`- 📄 ${d.nombre}${d.ruta ? ` — [abrir](${encodeURI(d.ruta)})` : ''}`));
    p.archivos.forEach((a) => L.push(`- 📎 ${a.nombre}${a.archivo ? ` — [abrir](${encodeURI(a.archivo)})` : ''}${a.error ? ` ⚠️ ${a.error}` : ''}`));
    L.push('', '## Conversaciones', '');
    if (!p.conversaciones.length) L.push('_(ninguna)_');
    p.conversaciones.forEach((c) => L.push(`- ${c.titulo}${c.creada ? ` (${String(c.creada).slice(0, 10)})` : ''}${c.carpeta ? ` — [abrir](${encodeURI(c.carpeta + '/conversacion.md')})` : ''}`));
    return L.join('\n') + '\n';
  }

  // Rutas a sondear con el botón de diagnóstico (solo se registran estado y forma, nunca contenido).
  function urlsDiagnostico(_org, { proyectoId, skillId } = {}) {
    const urls = [...proyectos.urlsLista(), ...skills.urlsLista()];
    if (proyectoId) {
      const b = `/backend-api/gizmos/${proyectoId}`;
      urls.push(b, `${b}/conversations?cursor=0`);
    }
    if (skillId) {
      const b = `/backend-api/skills/${encodeURIComponent(skillId)}`;
      urls.push(b, `${b}/versions`, `${b}/files`, `${b}/download`);
    }
    return urls;
  }

  const api = { urlsDiagnostico, proyectos, skills, reconstruirArchivosSkill, construirLeemeProyecto, lista, pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recursos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
