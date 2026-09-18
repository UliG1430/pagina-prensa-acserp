const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const Model = require('../content-model');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('La landing pinta el snapshot estático sin esperar la API', async t => {
  const html = fs.readFileSync(require.resolve('../pagina-independiente_4.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.fetch = () => new Promise(() => {});
  w.INITIAL_PRESS_CONTENT = JSON.parse(fs.readFileSync(require.resolve('../content.json'), 'utf8'));
  w.eval(fs.readFileSync(require.resolve('../content-model.js'), 'utf8'));
  w.eval(fs.readFileSync(require.resolve('../public-content.js'), 'utf8'));
  assert.ok(w.document.querySelectorAll('#grid-diarios article').length > 0);
  assert.ok(w.document.querySelectorAll('#grid-entrevistas article').length > 0);
  assert.ok(w.document.querySelectorAll('#grid-noticieros article').length > 0);
});

test('Editor separado: carruseles por sección, imágenes, textos y errores de guardado', async t => {
  const publicHtml = fs.readFileSync(require.resolve('../pagina-independiente_4.html'), 'utf8');
  assert.doesNotMatch(publicHtml, /form-login-admin|form-item-admin/, 'la landing no contiene el acceso ni el editor');
  const html = fs.readFileSync(require.resolve('../admin.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/admin', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, d = w.document, $ = id => d.getElementById(id);
  assert.equal(d.querySelector('.recuperar-admin').href, 'https://acserp.org.ar/admin', 'password recovery points to web-acserp');
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  let stored = Model.normalize({ diarios: [[{ imagenes: [image], texto: 'Original', link: '' }], [], []], entrevistas: [], noticieros: [] });
  let fail = false, uploaded = 0;
  w.structuredClone = structuredClone; w.confirm = () => true;
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.Image = class { set src(value) { queueMicrotask(() => this.onload()); } };
  w.fetch = async (endpoint, options = {}) => {
    if (endpoint === '/api/images') { uploaded++; return { ok: true, json: async () => ({ url: '/uploads/test.png' }) }; }
    if (options.method === 'PUT') {
      if (fail) return { ok: false, json: async () => ({ error: 'La sesión venció.' }) };
      stored = JSON.parse(options.body); return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => structuredClone(stored) };
  };
  w.eval(fs.readFileSync(require.resolve('../content-model.js'), 'utf8'));
  w.eval(fs.readFileSync(require.resolve('../editor.js'), 'utf8')); await tick();
  assert.equal($('vista-login-admin').hidden, false, '/admin abre el acceso editorial como página propia');
  assert.equal($('vista-panel-admin').hidden, true);
  $('input-correo-admin').value = 'modeloonulp@gmail.com'; $('input-clave-admin').value = 'test';
  $('form-login-admin').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.equal($('vista-login-admin').hidden, true); assert.equal($('vista-panel-admin').hidden, false);
  const select = async type => { d.querySelector(`[data-tipo="${type}"]`).click(); await tick(); };
  const count = () => d.querySelectorAll('[data-carrusel]').length;
  assert.deepEqual(Array.from(d.querySelectorAll('[data-tipo]')).slice(0, 3).map(n => n.dataset.tipo), ['diarios', 'entrevistas', 'noticieros']);
  assert.equal(count(), 3);
  for (const type of ['entrevistas', 'noticieros', 'diarios']) {
    await select(type); const initial = count();
    assert.equal(initial, type === 'diarios' ? 3 : 1);
    $('agregar-carrusel').click(); await tick(); assert.equal(count(), initial + 1);
    $('eliminar-carrusel').click(); await tick(); assert.equal(count(), initial);
  }
  await select('entrevistas');
  $('eliminar-carrusel').click(); await tick(); assert.equal(count(), 0); assert.equal($('form-item-admin').hidden, true);
  $('agregar-carrusel').click(); await tick(); assert.equal(count(), 1); assert.equal($('form-item-admin').hidden, false);
  assert.equal($('campo-video-admin').hidden, true);
  await select('noticieros'); assert.equal($('campo-video-admin').hidden, false);
  await select('diarios');
  Object.defineProperty($('input-imagen-archivo'), 'files', { configurable: true, value: [new w.File(['png'], 'portada.png', { type: 'image/png' })] });
  $('input-imagen-archivo').dispatchEvent(new w.Event('change')); await tick(); await tick();
  assert.equal(uploaded, 1); assert.equal($('input-imagen-url').value, '/uploads/test.png');
  assert.equal(d.querySelector('#vista-previa-imagenes img').getAttribute('src'), '/uploads/test.png');
  $('input-texto-admin').value = 'Nueva tarjeta';
  $('form-item-admin').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert.equal(stored.diarios[0].length, 2);
  fail = true; $('input-texto-admin').value = 'No debe guardarse'; $('input-imagen-url').value = '/uploads/test.png';
  $('form-item-admin').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert.equal(stored.diarios[0].length, 2); assert.equal($('input-texto-admin').value, 'No debe guardarse'); assert.match($('estado-editor').textContent, /sesión venció/);
  fail = false;
  await select('encabezado'); assert.equal($('editor-tarjetas').hidden, true); assert.equal($('form-textos-admin').hidden, false);
  $('input-titulo').value = '<b>Nuevo título</b>'; $('input-introduccion').value = 'Introducción nueva'; $('input-lema').value = 'Nuevo lema';
  $('form-textos-admin').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert.equal(stored.textos.titulo, '<b>Nuevo título</b>');
  await select('pie'); $('input-pie').value = 'Nuevo pie\nSegunda línea';
  $('form-textos-admin').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert.equal(stored.textos.pie, 'Nuevo pie\nSegunda línea');
  await select('entrevistas'); assert.equal(count(), 1);
  $('boton-cerrar-sesion-admin').click(); await tick();
  assert.equal($('vista-panel-admin').hidden, true, 'cerrar sesión oculta el panel sin mostrar la landing');
  assert.equal($('vista-login-admin').hidden, false, 'cerrar sesión permanece en el acceso de /admin');
});
