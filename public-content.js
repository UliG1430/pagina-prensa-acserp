(() => {
  const { TYPES, normalize, safeUrl } = window.ContentModel;
  const labels = { diarios: 'Ver diario', entrevistas: 'Ver entrevista', noticieros: 'Ver más' };
  const $ = id => document.getElementById(id);
  const escape = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const url = (value, image = false) => safeUrl(value || '', image) ? escape(value) : '';
  let carouselCleanups = [];
  let lastRendered = '';

  function gallery(item) {
    return `<img src="${url(item.imagenes?.[0], true)}" alt="Portada" loading="lazy" decoding="async">`;
  }

  function card(item, type) {
    const preview = type === 'noticieros' && item.video ? `<video muted playsinline preload="none" data-preview-video src="${url(item.video)}"></video>` : '';
    const link = `<a href="${url(item.link || '#')}"${item.link ? ' target="_blank" rel="noopener noreferrer"' : ''}`;
    const controls = item.imagenes.length > 1 ? `<div class="galeria-controles">${item.imagenes.map((source, index) => `<button type="button" data-image="${url(source, true)}" aria-label="Ver imagen ${index + 1}">${index + 1}</button>`).join('')}</div>` : '';
    if (type === 'entrevistas') return `<article class="tarjeta-entrevista"><div class="tarjeta-entrevista__preview">${gallery(item)}<span class="tarjeta-entrevista__badge">Vista previa</span></div>${controls}<div class="tarjeta-entrevista__info"><div><h3>${escape(item.texto)}</h3><time class="fecha">Septiembre, 2026</time></div>${link} class="boton-acceso">Ver entrevista ↗</a></div></article>`;
    return `<article class="tarjeta-recurso">${link} class="tarjeta-recurso__imagen"><div class="noticiero-preview${preview ? ' con-video' : ''}">${gallery(item)}${preview}</div><span class="tarjeta-recurso__enlace">${labels[type]} ↗</span></a>${controls}<p class="tarjeta-recurso__descripcion">${escape(item.texto)}</p></article>`;
  }

  function initCarousel(wrapper) {
    const track = wrapper.querySelector('[data-track]');
    const originals = Array.from(track.querySelectorAll('article'));
    const count = originals.length;
    wrapper.classList.toggle('carrusel-unico', count <= 1);
    wrapper.querySelectorAll('[data-prev], [data-next]').forEach(button => { button.hidden = count <= 1; });
    if (count <= 1) return;
    const before = document.createDocumentFragment(), after = document.createDocumentFragment();
    originals.forEach(item => { before.append(item.cloneNode(true)); after.append(item.cloneNode(true)); });
    track.prepend(before); track.append(after);
    const cards = Array.from(track.children);
    let span = 0, firstCenter = 0, frame = 0, timer;
    const center = item => item.offsetLeft + item.offsetWidth / 2 - track.clientWidth / 2;
    const focus = () => {
      frame = 0;
      const middle = track.scrollLeft + track.clientWidth / 2;
      cards.forEach(item => {
        const distance = Math.abs(middle - (item.offsetLeft + item.offsetWidth / 2));
        const normalized = Math.min(distance / (track.clientWidth / 2 || 1), 1);
        item.style.opacity = String(1 - normalized * .7);
        item.style.filter = `blur(${(normalized * 4).toFixed(1)}px)`;
        item.style.transform = `scale(${(1 - normalized * .14).toFixed(3)})`;
      });
    };
    const jump = left => {
      const behavior = track.style.scrollBehavior, snap = track.style.scrollSnapType;
      track.style.scrollBehavior = 'auto'; track.style.scrollSnapType = 'none'; track.scrollLeft = left;
      track.style.scrollBehavior = behavior; track.style.scrollSnapType = snap; focus();
    };
    const layout = () => {
      if (!track.clientWidth) return;
      span = cards[count].offsetLeft - cards[0].offsetLeft;
      firstCenter = center(cards[count]); jump(firstCenter);
    };
    const step = () => cards[1].offsetLeft - cards[0].offsetLeft;
    track.addEventListener('scroll', () => {
      if (!frame) frame = requestAnimationFrame(focus);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!span) return;
        if (track.scrollLeft < firstCenter - step() / 2) jump(track.scrollLeft + span);
        else if (track.scrollLeft >= firstCenter + span - step() / 2) jump(track.scrollLeft - span);
      }, 140);
    }, { passive: true });
    wrapper.querySelector('[data-prev]').onclick = () => track.scrollBy({ left: -step(), behavior: 'smooth' });
    wrapper.querySelector('[data-next]').onclick = () => track.scrollBy({ left: step(), behavior: 'smooth' });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null;
    observer?.observe(track); layout();
    carouselCleanups.push(() => { observer?.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); });
  }

  function render(content) {
    const normalized = normalize(content);
    const serialized = JSON.stringify(normalized);
    if (serialized === lastRendered) return;
    lastRendered = serialized;
    carouselCleanups.forEach(cleanup => cleanup()); carouselCleanups = [];
    for (const key of ['titulo', 'introduccion', 'lema', 'pie']) $('texto-' + key).textContent = normalized.textos[key];
    for (const type of TYPES) {
      const container = $('grid-' + type);
      container.className = type === 'entrevistas' ? '' : 'carrusel-diarios';
      container.innerHTML = normalized[type].map((group, index) => {
        const interview = type === 'entrevistas';
        const wrapper = interview ? 'carrusel-envoltorio' : 'diario-carrusel';
        const arrow = interview ? 'carrusel-flecha' : 'diario-carrusel__flecha';
        return `<div class="${wrapper}" data-carousel data-diario="${type}" aria-label="${type}, carrusel ${index + 1}"><button type="button" class="${arrow} ${arrow}--prev" data-prev aria-label="Anterior">‹</button><div class="${interview ? 'carrusel-entrevistas' : 'diario-carrusel__pista'}" data-dinamico="true" data-track>${group.length ? group.map(item => card(item, type)).join('') : '<p class="tarjeta-recurso__descripcion">Todavía no hay publicaciones en este carrusel.</p>'}</div><button type="button" class="${arrow} ${arrow}--next" data-next aria-label="Siguiente">›</button></div>`;
      }).join('');
      container.querySelectorAll('[data-carousel]').forEach(initCarousel);
      container.querySelectorAll('[data-image]').forEach(button => { button.onclick = () => { button.closest('article').querySelector('img').src = button.dataset.image; }; });
      container.querySelectorAll('[data-preview-video]').forEach(video => {
        const article = video.closest('article');
        const stop = () => { video.pause(); video.currentTime = 0; };
        article.onmouseenter = article.onfocusin = () => { video.currentTime = 0; video.play().catch(() => {}); };
        article.onmouseleave = article.onfocusout = stop;
        video.ontimeupdate = () => { if (video.currentTime >= 5) stop(); };
      });
    }
  }

  // El snapshot estático evita que la primera pintura dependa de una Function o de Blobs.
  if (window.INITIAL_PRESS_CONTENT) render(window.INITIAL_PRESS_CONTENT);
  fetch('/api/content', { credentials: 'same-origin' })
    .then(response => response.ok ? response.json() : Promise.reject(new Error('content')))
    .then(render)
    .catch(() => { /* El snapshot estático mantiene la página utilizable si la API no responde. */ });
})();
