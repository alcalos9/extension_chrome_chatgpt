// Ejecutar: node tests/core.test.js
const assert = require('assert');
const Core = require('../core.js');

const nodo = (id, parent, children, message) => ({ id, parent, children, message });
const msg = (id, rol, content, extra = {}) => ({
  id, author: { role: rol, name: extra.name }, create_time: extra.t || 1735725600, content,
  metadata: extra.metadata || {}, recipient: extra.recipient || 'all',
});

const raw = {
  conversation_id: 'c1', title: 'Análisis de contrato', create_time: 1735725600, update_time: 1735725900,
  default_model_slug: 'gpt-5', current_node: 'n8',
  mapping: {
    root: nodo('root', null, ['n1'], null),
    n1: nodo('n1', 'root', ['n2'], msg('m1', 'system', { content_type: 'text', parts: [''] })),
    n2: nodo('n2', 'n1', ['n3', 'n3x'], msg('m2', 'user', { content_type: 'multimodal_text', parts: [
      { content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-IMG1', size_bytes: 1234 },
      'Revisa este PDF y la foto'] }, { metadata: { attachments: [
      { id: 'file-DOC1', name: 'contrato.pdf', mime_type: 'application/pdf', size: 2048 },
      { id: 'file-IMG1', name: 'foto.png', mime_type: 'image/png', size: 1234 }] } })),
    // rama descartada (regeneración)
    n3x: nodo('n3x', 'n2', [], msg('mx', 'assistant', { content_type: 'text', parts: ['Rama descartada'] })),
    n3: nodo('n3', 'n2', ['n4'], msg('m3', 'assistant', { content_type: 'thoughts', thoughts: [{ summary: 'Pensando', content: 'detalle' }] })),
    n4: nodo('n4', 'n3', ['n5'], msg('m4', 'assistant', { content_type: 'text', parts: ['{"q":"mazda cx-9"}'] }, { recipient: 'web.search' })),
    n5: nodo('n5', 'n4', ['n6'], msg('m5', 'tool', { content_type: 'tether_browsing_display', result: 'resultados…' }, { name: 'web.search' })),
    n6: nodo('n6', 'n5', ['n7'], msg('m6', 'tool', { content_type: 'multimodal_text', parts: [
      { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_GEN1' }] }, { name: 'dalle.text2im' })),
    n7: nodo('n7', 'n6', ['n8'], msg('m7', 'assistant', { content_type: 'text', parts: [
      'Aquí está el resultadociteturn0search0 y el [archivo](sandbox:/mnt/data/resumen%20final.csv).'] })),
    n8: nodo('n8', 'n7', [], msg('m8', 'user', { content_type: 'text', parts: ['gracias'] })),
  },
};

const conv = Core.normalizarApi(raw);
assert.deepStrictEqual(conv.mensajes.map((m) => m.rol), ['Usuario', 'ChatGPT', 'Usuario'],
  'los nodos de herramienta/asistente consecutivos forman un solo turno; system se omite');
assert.strictEqual(conv.mensajes[1].texto, 'Aquí está el resultado y el [archivo](sandbox:/mnt/data/resumen%20final.csv).');
assert.ok(!conv.mensajes[1].texto.includes('Rama descartada'));
assert.deepStrictEqual(conv.mensajes.map((m) => m.indice), [1, 2, 3]);
assert.strictEqual(conv.modelo, 'gpt-5');
assert.strictEqual(conv.creada, '2025-01-01T10:00:00.000Z');

// Adjuntos del usuario: imagen no duplicada (puntero + metadata) y documento
const u = conv.mensajes[0].adjuntos;
assert.strictEqual(u.length, 2);
assert.strictEqual(u.find((a) => a.clase === 'imagen').nombre, 'foto.png');
assert.deepStrictEqual(u.find((a) => a.clase === 'documento').ref, { tipo: 'file', id: 'file-DOC1' });

// Turno del asistente: imagen generada por herramienta + archivo de sandbox
const a = conv.mensajes[1].adjuntos;
const gen = a.find((x) => x.origen === 'generada');
assert.deepStrictEqual(gen.ref, { tipo: 'file', id: 'file_GEN1' }, 'sediment:// → id del archivo');
const sb = a.find((x) => x.origen === 'sandbox');
assert.strictEqual(sb.nombre, 'resumen final.csv');
assert.deepStrictEqual(sb.ref, { tipo: 'sandbox', ruta: '/mnt/data/resumen%20final.csv', mensaje: 'm7' });

// Bloques: razonamiento, llamada a herramienta (recipient≠all), resultado
assert.deepStrictEqual(conv.mensajes[1].bloques.map((b) => b.tipo), ['razonamiento', 'herramienta', 'resultado_herramienta']);

const md = Core.construirMarkdown(conv, { incluirRazonamiento: true });
assert.ok(md.includes('## 👤 Usuario · #1') && md.includes('## 🤖 ChatGPT · #2'));
assert.ok(md.includes('Razonamiento') && md.includes('web.search'));
assert.ok(!Core.construirMarkdown(conv).includes('Razonamiento'));

// sin current_node: toma la hoja más reciente
const sinHoja = Core.normalizarApi({ ...raw, current_node: null });
assert.ok(sinHoja.mensajes.length >= 2);

assert.strictEqual(Core.limpiarTexto('Hola entity["city","Santiago","capital"] y 【12†fuente】fin'), 'Hola Santiago y fin');
assert.strictEqual(Core.nombreSeguro('¡Análisis: contrato 2025!'), 'analisis_contrato_2025');
assert.strictEqual(Core.nombreArchivoSeguro('Mi Contrato Ñandú (final).PDF'), 'Mi_Contrato_Nandu_final.pdf');
assert.strictEqual(Core.nombreArchivoSeguro('../../etc/passwd'), 'passwd');
const usados = new Set();
assert.strictEqual(Core.nombreUnico(usados, 'a/x.png'), 'a/x.png');
assert.strictEqual(Core.nombreUnico(usados, 'a/x.png'), 'a/x_2.png');
assert.strictEqual(Core.extDesdeMime('image/webp; charset=x'), 'webp');

const dom = Core.normalizarDom({ titulo: 'T', mensajes: [
  { rol: 'Usuario', texto: 'hola', imagenes: [{ url: 'https://x/y.png' }], adjuntos: ['a.pdf'] },
  { rol: 'ChatGPT', texto: 'qué tal', imagenes: [], adjuntos: [] }] });
assert.strictEqual(dom.mensajes[0].adjuntos.length, 2);
assert.strictEqual(dom.mensajes[1].rol, 'ChatGPT');

console.log('core.test.js: OK');
