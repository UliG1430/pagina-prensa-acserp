(() => {
  const { TYPES, normalize, safeUrl, valid } = window.ContentModel;
  const $ = id => document.getElementById(id);
  let contenido, tipo = 'diarios', carrusel = 0, editando = null, busy = false;
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const url = (value, image = false) => safeUrl(value || '', image) ? escape(value) : '';
  const imageList = () => $('input-imagen-url').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const status = (message = '', error = false) => { $('estado-editor').textContent = message; $('estado-editor').classList.toggle('error', error); };
  function setBusy(value) {
    busy = value;
    $('vista-panel-admin').querySelectorAll('button, input, textarea').forEach(node => { node.disabled = value; });
    if (!value) { $('eliminar-carrusel').disabled = !TYPES.includes(tipo) || !contenido[tipo].length; $('agregar-carrusel').disabled = TYPES.includes(tipo) && contenido[tipo].length >= 20; }
  }
  async function api(endpoint, options = {}) {
    const response = await fetch(endpoint, { credentials: 'same-origin', ...options });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
    return result;
  }
  async function save(change) {
    if (busy) return false;
    const next = structuredClone(contenido); change(next);
    if (!valid(next)) { status('Revisá los campos: hasta 20 carruseles por sección, 100 tarjetas por carrusel y 20 imágenes por tarjeta.', true); return false; }
    setBusy(true); status('Guardando…');
    try {
      await api('/api/content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      contenido = next; status('Cambios guardados.'); return true;
    } catch (error) { status(error.message, true); return false; }
    finally { setBusy(false); }
  }
  function previews() {
    const list = imageList();
    $('vista-previa-imagenes').innerHTML = list.map((src, i) => `<figure><img src="${url(src, true)}" alt="Imagen ${i + 1}"><figcaption>Imagen ${i + 1}</figcaption><button type="button" data-remove-image="${i}">Quitar</button></figure>`).join('');
    $('vista-previa-imagenes').querySelectorAll('img').forEach(img => { img.onerror = () => { img.nextElementSibling.textContent = 'No se pudo cargar. Revisá que el enlace sea público y directo.'; }; });
    $('vista-previa-imagenes').querySelectorAll('button').forEach(button => { button.onclick = () => { const images = imageList(); images.splice(Number(button.dataset.removeImage), 1); $('input-imagen-url').value = images.join('\n'); previews(); }; });
  }
  function resetForm() {
    $('form-item-admin').reset(); editando = null;
    $('titulo-form-item').textContent = 'Agregar nueva tarjeta';
    $('boton-guardar-item').textContent = 'Agregar tarjeta';
    $('boton-cancelar-edicion').hidden = true; previews();
  }
  function renderEditor() {
    const cards = TYPES.includes(tipo);
    $('editor-tarjetas').hidden = !cards; $('form-textos-admin').hidden = cards;
    $('campos-encabezado').hidden = tipo !== 'encabezado'; $('campos-pie').hidden = tipo !== 'pie';
    if (!cards) { for (const key of ['titulo', 'introduccion', 'lema', 'pie']) $('input-' + key).value = contenido.textos[key]; return; }
    const groups = contenido[tipo]; carrusel = Math.max(0, Math.min(carrusel, groups.length - 1));
    $('pestanias-carruseles').innerHTML = groups.map((group, i) => `<button type="button" class="pestania-admin" data-carrusel="${i}" aria-pressed="${i === carrusel}">Carrusel ${i + 1} (${group.length})</button>`).join('') || '<p>No hay carruseles. Agregá uno para empezar.</p>';
    $('pestanias-carruseles').querySelectorAll('button').forEach(button => { button.onclick = () => { carrusel = Number(button.dataset.carrusel); resetForm(); renderEditor(); status(); }; });
    $('form-item-admin').hidden = !groups.length;
    $('campo-video-admin').hidden = tipo !== 'noticieros';
    $('eliminar-carrusel').disabled = !groups.length; $('agregar-carrusel').disabled = groups.length >= 20;
    const items = groups[carrusel] || [];
    $('lista-items-admin').innerHTML = items.map((item, i) => `<div class="item-admin"><img src="${url(item.imagenes[0], true)}" alt=""><div class="item-admin__texto">${escape(item.texto)}</div><div class="item-admin__acciones"><button type="button" class="boton-admin boton-admin--secundario" data-edit="${i}">Editar</button><button type="button" class="boton-admin boton-admin--peligro" data-delete="${i}">Eliminar</button></div></div>`).join('');
    $('lista-items-admin').querySelectorAll('[data-edit]').forEach(button => { button.onclick = () => {
      resetForm(); editando = Number(button.dataset.edit); const item = items[editando];
      $('input-imagen-url').value = item.imagenes.join('\n'); $('input-video-admin').value = item.video || ''; $('input-link-admin').value = item.link || ''; $('input-texto-admin').value = item.texto;
      $('titulo-form-item').textContent = 'Editando tarjeta'; $('boton-guardar-item').textContent = 'Guardar cambios'; $('boton-cancelar-edicion').hidden = false; previews();
    }; });
    $('lista-items-admin').querySelectorAll('[data-delete]').forEach(button => { button.onclick = async () => {
      if (!confirm('¿Eliminar esta tarjeta?')) return;
      if (await save(next => next[tipo][carrusel].splice(Number(button.dataset.delete), 1))) { resetForm(); renderEditor(); }
    }; });
  }
  document.querySelectorAll('[data-tipo]').forEach(button => { button.onclick = () => {
    tipo = button.dataset.tipo; carrusel = 0; resetForm(); status();
    document.querySelectorAll('[data-tipo]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
    renderEditor();
  }; });
  $('agregar-carrusel').onclick = async () => { if (await save(next => next[tipo].push([]))) { carrusel = contenido[tipo].length - 1; resetForm(); renderEditor(); } };
  $('eliminar-carrusel').onclick = async () => {
    if (!contenido[tipo].length || !confirm(`¿Eliminar el carrusel ${carrusel + 1} y sus ${contenido[tipo][carrusel].length} tarjetas?`)) return;
    if (await save(next => next[tipo].splice(carrusel, 1))) { resetForm(); renderEditor(); }
  };
  $('input-imagen-url').oninput = previews;
  $('input-imagen-archivo').onchange = async () => {
    const files = Array.from($('input-imagen-archivo').files); if (!files.length) return;
    if (files.length + imageList().length > 20) { status('Podés agregar hasta 20 imágenes por tarjeta.', true); return; }
    if (files.some(file => file.size > 20 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))) { status('Usá JPG, PNG, WebP o GIF de hasta 20 MB por archivo.', true); return; }
    setBusy(true); status('Subiendo imágenes…');
    try {
      for (const file of files) {
        const image = new Image(); const local = URL.createObjectURL(file);
        try { await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('El archivo no se puede abrir como imagen.')); image.src = local; }); }
        finally { URL.revokeObjectURL(local); }
        const uploadId = crypto.randomUUID(), chunkSize = 2 * 1024 * 1024, parts = Math.ceil(file.size / chunkSize); let result;
        for (let part = 0; part < parts; part++) result = await api('/api/images', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Upload-Id': uploadId, 'X-Upload-Part': String(part), 'X-Upload-Parts': String(parts) }, body: file.slice(part * chunkSize, Math.min(file.size, (part + 1) * chunkSize)) });
        $('input-imagen-url').value = [...imageList(), result.url].join('\n');
      }
      status('Imágenes subidas. Guardá la tarjeta para publicarlas.');
    } catch (error) { status(error.message, true); }
    finally { $('input-imagen-archivo').value = ''; previews(); setBusy(false); }
  };
  $('boton-cancelar-edicion').onclick = resetForm;
  $('form-item-admin').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const images = imageList(), text = $('input-texto-admin').value.trim();
    if (!images.length || !text) { status('Agregá al menos una imagen y el texto de la tarjeta.', true); return; }
    if (images.some(src => !safeUrl(src, true)) || !safeUrl($('input-link-admin').value.trim()) || !safeUrl($('input-video-admin').value.trim())) { status('Usá direcciones públicas o archivos del proyecto. No se admiten rutas de tu computadora.', true); return; }
    const item = { imagenes: images, texto: text, link: $('input-link-admin').value.trim(), video: tipo === 'noticieros' ? $('input-video-admin').value.trim() : '' };
    if (await save(next => { if (editando === null) next[tipo][carrusel].push(item); else next[tipo][carrusel][editando] = item; })) { resetForm(); renderEditor(); }
  };
  $('form-textos-admin').onsubmit = async event => {
    event.preventDefault(); await save(next => { for (const key of tipo === 'pie' ? ['pie'] : ['titulo', 'introduccion', 'lema']) next.textos[key] = $('input-' + key).value; });
  };
  function showLogin() {
    $('vista-panel-admin').hidden = true; $('vista-login-admin').hidden = false;
    $('input-clave-admin').value = ''; $('input-correo-admin').focus();
  }
  function showPanel() {
    $('vista-login-admin').hidden = true; $('vista-panel-admin').hidden = false;
    resetForm(); renderEditor();
  }
  $('form-login-admin').onsubmit = async event => {
    event.preventDefault(); $('error-login-admin').textContent = '';
    try {
      await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('input-correo-admin').value, password: $('input-clave-admin').value }) });
      contenido = normalize(await api('/api/content')); showPanel();
    } catch (error) { $('error-login-admin').textContent = error.message; }
  };
  $('boton-cerrar-sesion-admin').onclick = async () => {
    try { await api('/api/logout', { method: 'POST' }); showLogin(); } catch (error) { status(error.message, true); }
  };
  api('/api/content').then(data => {
    contenido = normalize(data); renderEditor(); showLogin();
  }).catch(() => { $('error-login-admin').textContent = 'No se pudo cargar el contenido. Recargá la página antes de editar.'; });
})();
