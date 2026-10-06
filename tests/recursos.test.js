// Ejecutar: node tests/recursos.test.js
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');
const R = require('../recursos.js');

(async () => {
  // ---- lista de proyectos: la barra lateral mezcla GPTs y proyectos ----
  const sidebar = { items: [
    { gizmo: { gizmo: { id: 'g-p-111', display: { name: 'Consulting', description: 'Proyecto de consultoría' }, instructions: 'Sé breve' } } },
    { gizmo: { gizmo: { id: 'g-abc', display: { name: 'Un GPT' } } } },
    { gizmo: { gizmo: { id: 'g-p-222', display: { name: 'Otro' } } } }] };
  const todos = R.proyectos.normalizarLista(sidebar);
  assert.deepStrictEqual(todos.map((p) => [p.id, p.nombre]), [['g-p-111', 'Consulting'], ['g-abc', 'Un GPT'], ['g-p-222', 'Otro']]);
  const l = await R.proyectos.listar({ async consultar() { return { url: 'x', data: sidebar }; } });
  assert.deepStrictEqual(l.items.map((p) => p.id), ['g-p-111', 'g-p-222'], 'solo proyectos (g-p-…) cuando se distinguen');
  assert.deepStrictEqual(R.proyectos.normalizarLista(null), []);

  // ---- cargar proyecto: detalle, archivos por referencia y conversaciones paginadas por cursor ----
  const paginas = {
    '0': { items: [{ id: 'c1', title: 'Chat 1', create_time: 1735725600 }, { id: 'c2', title: 'Chat 2', create_time: 1735725700 }], cursor: '2' },
    '2': { items: [{ id: 'c3', title: 'Chat 3' }], cursor: null },
  };
  const pedidas = [];
  const ctx = {
    origin: 'https://chatgpt.com',
    async consultar(urls) {
      const u = urls[0];
      pedidas.push(u);
      if (u === '/backend-api/gizmos/g-p-111') return { url: u, data: { gizmo: { instructions: 'Sé breve', display: { description: 'Desc nueva' } }, files: [{ file_id: 'file-A', name: 'contrato.pdf', type: 'application/pdf', size: 10 }, { id: 'file-B', name: 'foto.png', mime_type: 'image/png' }] } };
      const m = u.match(/^\/backend-api\/gizmos\/g-p-111\/conversations\?cursor=(.*)$/);
      if (m && paginas[decodeURIComponent(m[1])]) return { url: u, data: paginas[decodeURIComponent(m[1])] };
      throw new Error('HTTP 404 en ' + u);
    },
    async binario() { return null; },
  };
  const p = await R.proyectos.cargar(ctx, l.items[0]);
  assert.strictEqual(p.instrucciones, 'Sé breve');
  assert.strictEqual(p.descripcion, 'Desc nueva');
  assert.deepStrictEqual(p.archivos.map((a) => [a.nombre, a.clase, a.ref.id]), [['contrato.pdf', 'documento', 'file-A'], ['foto.png', 'imagen', 'file-B']]);
  assert.deepStrictEqual(p.conversaciones.map((c) => c.id), ['c1', 'c2', 'c3'], 'recorre todas las páginas por cursor');
  assert.strictEqual(p.conversaciones[0].creada, '2025-01-01T10:00:00.000Z');
  assert.strictEqual(p.errores.length, 0);
  assert.ok(pedidas.some((u) => u.endsWith('cursor=2')));

  // proyecto sin acceso a nada: se informa sin romper
  const vacio = await R.proyectos.cargar({ origin: 'x', async consultar() { throw new Error('HTTP 403'); } }, l.items[0]);
  assert.strictEqual(vacio.errores.length, 2);
  assert.deepStrictEqual(vacio.conversaciones, []);

  const md = R.construirLeemeProyecto({ ...p, docs: [], archivos: p.archivos.map((a) => ({ ...a, archivo: 'conocimiento/archivos/' + a.nombre })) });
  assert.ok(md.includes('# Consulting') && md.includes('Sé breve') && md.includes('conocimiento/archivos/contrato.pdf') && md.includes('Chat 3'));

  // ---- skills ----
  const lista = R.skills.normalizarLista({ items: [
    { id: 's1', name: 'informe-ejecutivo', description: 'Hace informes' },
    { id: 's2', name: 'pdf', source: 'openai' },
    { id: 's3', name: 'sistema', is_system: true }] });
  assert.deepStrictEqual(lista.map((s) => [s.id, s.tipo]), [['s1', 'personal'], ['s2', 'openai'], ['s3', 'openai']]);

  const z = new JSZip();
  z.file('informe-ejecutivo/SKILL.md', '---\nname: informe-ejecutivo\n---\nPasos');
  const b64 = await z.generateAsync({ type: 'base64' });
  const conZip = await R.skills.cargar({ async consultar() { throw new Error('HTTP 404'); }, async binario(urls) { assert.ok(urls[0].endsWith('/skills/s1/download')); return { url: urls[0], type: 'application/zip', b64 }; } }, lista[0]);
  assert.strictEqual(conZip.zipB64, b64);
  assert.strictEqual(conZip.errores.length, 0);

  const conJson = await R.skills.cargar({ async binario() { return null; }, async consultar() { return { url: 'x', data: { skill: { files: [{ path: 'SKILL.md', content: '---\nname: x\n---\nhola' }, { path: 'scripts/run.py', content: 'print(1)' }] } } }; } }, lista[0]);
  assert.deepStrictEqual(conJson.archivos.map((f) => f.ruta), ['SKILL.md', 'scripts/run.py']);

  const md2 = R.reconstruirArchivosSkill({ instructions: 'Haz esto' }, 'mi-skill', 'Descripción\nlarga');
  assert.ok(md2[0].contenido.startsWith('---\nname: mi-skill\ndescription: Descripción larga\n---'));

  const nada = await R.skills.cargar({ async binario() { return null; }, async consultar() { throw new Error('HTTP 404'); } }, { id: 's9', nombre: 'raro', descripcion: '', raw: {} });
  assert.ok(nada.errores.some((e) => /no se encontró el contenido/.test(e)));

  const diag = R.urlsDiagnostico(null, { proyectoId: 'g-p-111', skillId: 's1' });
  assert.ok(diag.some((u) => u.endsWith('/gizmos/g-p-111/conversations?cursor=0')) && diag.some((u) => u.endsWith('/skills/s1/download')));

  console.log('recursos.test.js: OK');
})().catch((e) => { console.error(e); process.exit(1); });
