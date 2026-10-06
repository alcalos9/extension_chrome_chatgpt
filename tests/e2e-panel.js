// Prueba de integración del panel (pestañas, proyectos, skills, diagnóstico) con chrome.* y la página simulados.
// Requiere jsdom (solo para pruebas):  npm i --no-save jsdom && node tests/e2e-panel.js
const { JSDOM } = require('jsdom');
const path = require('path');
const JSZipNode = require(path.join(process.argv[2] || path.join(__dirname, '..'), 'vendor/jszip.min.js'));
const raiz = process.argv[2] || path.join(__dirname, '..');

// ---- página simulada (lo que haría page-lib.js en chatgpt.com) ----
const skillZip = new JSZipNode(); skillZip.file('mi-skill/SKILL.md', '---\nname: mi-skill\n---\ncuerpo'); skillZip.file('mi-skill/scripts/a.py', 'print(1)');
let skillB64;
const nodo = (id, parent, children, message) => ({ id, parent, children, message });
const conv = { conversation_id: 'c1', title: 'Chat del proyecto', create_time: 1735725600, current_node: 'n2', mapping: {
  n0: nodo('n0', null, ['n1'], null),
  n1: nodo('n1', 'n0', ['n2'], { id: 'm1', author: { role: 'user' }, create_time: 1735725600, recipient: 'all', metadata: { attachments: [{ id: 'file-IMG', name: 'foto.png', mime_type: 'image/png' }] }, content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-IMG' }, 'hola'] } }),
  n2: nodo('n2', 'n1', [], { id: 'm2', author: { role: 'assistant' }, create_time: 1735725700, recipient: 'all', metadata: {}, content: { content_type: 'text', parts: ['respuesta'] } }) } };
const data = {
  '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&owned_only=true': { items: [{ gizmo: { gizmo: { id: 'g-p-1', display: { name: 'Mi Proyecto', description: 'desc' } } } }, { gizmo: { gizmo: { id: 'g-gpt', display: { name: 'Un GPT' } } } }] },
  '/backend-api/gizmos/g-p-1': { gizmo: { instructions: 'Instrucciones del proyecto' }, files: [{ file_id: 'file-DOC', name: 'datos.csv', type: 'text/csv' }] },
  '/backend-api/gizmos/g-p-1/conversations?cursor=0': { items: [{ id: 'c1', title: 'Chat del proyecto' }], cursor: null },
  '/backend-api/skills': { skills: [{ id: 's1', name: 'mi-skill', description: 'hace cosas' }, { id: 's2', name: 'pdf', source: 'openai' }] },
};
const FAKE = {
  async consultar(urls) { for (const u of urls) if (data[u]) return { url: u, data: data[u] }; throw new Error('HTTP 404 en ' + urls[0]); },
  async binario(urls) { return urls[0].includes('/skills/s1/download') ? { url: urls[0], type: 'application/zip', b64: skillB64 } : null; },
  async fetchConversationApi(id) { return { data: conv }; },
  async resolverArchivo(ref) { return { url: 'https://files.oaiusercontent.com/' + ref.id, nombre: null }; },
  async fetchBinary() { return { ok: true, type: 'image/png', size: 3, b64: Buffer.from('PNG').toString('base64') }; },
  async diagnostico(urls) { return urls.map((u) => ({ url: u, estado: 404 })); },
};

(async () => {
  skillB64 = await skillZip.generateAsync({ type: 'base64' });
  const descargas = [];
  const dom = await JSDOM.fromFile(path.join(raiz, 'sidepanel.html'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) {
      w.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a); // JSZip lo usa para planificar; jsdom no lo trae
      w.clearImmediate = (id) => clearTimeout(id);
      w.fetch = async (u) => {            // solo se usan data: URLs desde el panel
        const m = String(u).match(/^data:([^;]*);base64,(.*)$/);
        if (!m) return { ok: true, status: 200, blob: async () => new w.Blob([Buffer.from('DATA')], { type: 'text/csv' }) };
        return { ok: true, status: 200, blob: async () => new w.Blob([Buffer.from(m[2], 'base64')], { type: m[1] }) };
      };
      w.__EXPORTAR_CHATGPT__ = FAKE;
      w.chrome = {
        tabs: { query: async () => [{ id: 1, url: 'https://chatgpt.com/', title: 'ChatGPT' }] },
        scripting: { executeScript: async ({ func, args }) => (func ? [{ result: await func(...args) }] : [{}]) },
        permissions: { contains: async () => true, request: async () => true },
      };
      w.URL.createObjectURL = (b) => { descargas.push(b); return 'blob:x'; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () { descargas.push({ nombre: this.download }); };
      w.addEventListener('error', (e) => { console.error('ERROR EN PÁGINA:', e.message); process.exitCode = 1; });
    },
  });
  const w = dom.window, d = w.document;
  await new Promise((r) => w.addEventListener('load', r));
  const esperar = async (cond, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  const leerBlob = (b) => new Promise((res) => { const fr = new w.FileReader(); fr.onload = () => res(Buffer.from(fr.result)); fr.readAsArrayBuffer(b); });

  // pestañas
  d.getElementById('tab-proyectos').click();
  console.log('vista proyectos visible:', !d.getElementById('vista-proyectos').hidden, '| chat oculto:', d.getElementById('vista-chat').hidden);

  // ---- proyectos ----
  d.getElementById('btn-listar-proyectos').click();
  await esperar(() => d.querySelectorAll('#lista-proyectos .item').length === 1);
  console.log('proyectos listados:', d.querySelectorAll('#lista-proyectos .item').length, '|', d.getElementById('estado').textContent);
  d.getElementById('btn-exportar-proyectos').click();
  await esperar(() => descargas.some((x) => x.nombre));
  console.log('estado tras exportar:', d.getElementById('estado').textContent); console.log(d.getElementById('log').textContent);
  const zipP = descargas.find((x) => x.size !== undefined);
  const z1 = await JSZipNode.loadAsync(await leerBlob(zipP));
  console.log('--- ZIP proyectos ---'); console.log(Object.keys(z1.files).filter((n) => !z1.files[n].dir).sort().join('\n'));
  console.log('instrucciones:', await z1.file(Object.keys(z1.files).find((n) => n.endsWith('instrucciones.md'))).async('string'));
  console.log('informe:', (await z1.file(Object.keys(z1.files).find((n) => n.endsWith('/informe.txt'))).async('string')).split('\n').slice(0, 4).join(' | '));
  console.log('estado final:', d.getElementById('estado').textContent);

  // ---- skills ----
  descargas.length = 0;
  d.getElementById('tab-skills').click();
  d.getElementById('btn-listar-skills').click();
  await esperar(() => d.querySelectorAll('#lista-skills .item').length === 2);
  const marcados = [...d.querySelectorAll('#lista-skills .item input')].map((c) => c.checked);
  console.log('skills listados:', marcados.length, '| marcados por defecto (personal sí, Anthropic no):', marcados);
  d.getElementById('btn-exportar-skills').click();
  await esperar(() => descargas.some((x) => x.nombre));
  console.log('estado tras skills:', d.getElementById('estado').textContent);
  const z2 = await JSZipNode.loadAsync(await leerBlob(descargas.find((x) => x.size !== undefined)));
  console.log('--- ZIP skills ---'); console.log(Object.keys(z2.files).filter((n) => !z2.files[n].dir).sort().join('\n'));
  console.log('estado final:', d.getElementById('estado').textContent);

  // ---- diagnóstico ----
  descargas.length = 0;
  d.getElementById('btn-diag').click();
  await esperar(() => descargas.some((x) => x.nombre));
  console.log('diagnóstico descargado como:', descargas.find((x) => x.nombre).nombre);
  w.close();
})().catch((e) => { console.error(e); process.exit(1); });
