/* naturesloom storefront
   Loads the catalog from a published Google Sheet (CSV), renders a filterable
   grid, and sends orders to WhatsApp with a pre-filled message. */
(() => {
  'use strict';

  /* ================= CONFIG: edit these ================= */
  const CONFIG = {
    // Google Sheets > File > Share > Publish to web > CSV > Publish, then paste the link here
    CSV_URL: https://docs.google.com/spreadsheets/d/e/2PACX-1vSLSlsXPfA_0yaGUVzusbikI7EDs7qPC3na2pa6PMbtrQUoTTY-ZiA2tAaJkd4CvI1pVYJdQa81f2vP/pub?gid=0&single=true&output=csv,
    WHATSAPP_NUMBER: '918088498045', // country code + number, no + or spaces
    STORE_NAME: 'naturesloom',
    IMAGE_DIR: './images/',
  };
  /* ====================================================== */

  const PLACEHOLDER =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 750">' +
        '<rect width="600" height="750" fill="#ebe3d3"/>' +
        '<g fill="none" stroke="#7e9170" stroke-width="6" stroke-linecap="round">' +
          '<path d="M300 300c0-30 30-40 30-65a30 30 0 1 0-60 0"/>' +
          '<path d="M300 300L150 400h300z"/>' +
        '</g>' +
        '<text x="300" y="500" text-anchor="middle" font-family="Georgia,serif" font-size="30" fill="#4f6144">naturesloom</text>' +
        '<text x="300" y="540" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#6b645b">Photo coming soon</text>' +
      '</svg>'
    );

  /* ---------- State ---------- */
  const state = { products: [], category: 'All', query: '', selectedSize: '', current: null };

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    grid: $('catalog'),
    filters: $('filters'),
    search: $('search'),
    status: $('status'),
    modal: $('modal'),
    mClose: $('m-close'),
    mImg: $('m-img'),
    mCat: $('m-cat'),
    mTitle: $('m-title'),
    mPrice: $('m-price'),
    mStock: $('m-stock'),
    mDesc: $('m-desc'),
    mSizes: $('m-sizes'),
    mSizeList: $('m-size-list'),
    mOrder: $('m-order'),
    mHint: $('m-hint'),
  };

  /* ---------- Helpers ---------- */
  function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((kid) => {
      if (kid == null) return;
      e.append(kid.nodeType ? kid : document.createTextNode(kid));
    });
    return e;
  }

  const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

  function parsePrice(v) {
    const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function formatINR(n) {
    if (!Number.isFinite(n)) return 'Price on request';
    return Number.isInteger(n) ? inr0.format(n) : inr2.format(n);
  }

  // Accepts "kurta-01.jpg", "images/kurta-01.jpg", "./images/kurta-01.jpg" or a full URL
  function resolveImage(value) {
    let f = String(value ?? '').trim();
    if (!f) return PLACEHOLDER;
    if (/^(https?:)?\/\//i.test(f) || f.startsWith('data:')) return f;
    f = f.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^images\//i, '');
    return CONFIG.IMAGE_DIR + f.split('/').map(encodeURIComponent).join('/');
  }

  function imageFileName(value) {
    const f = String(value ?? '').trim();
    if (!f || /^(https?:)?\/\//i.test(f) || f.startsWith('data:')) return '';
    return f.replace(/\\/g, '/').split('/').pop();
  }

  function parseSizes(v) {
    return String(v ?? '')
      .split(/[,/|;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function isOutOfStock(v) {
    return /out\s*of\s*stock|sold\s*out|unavailable|^no$|^0$/i.test(String(v ?? '').trim());
  }

  function makeImage(src, alt, lazy) {
    const img = h('img', { src, alt, decoding: 'async', loading: lazy ? 'lazy' : null });
    img.addEventListener('error', () => {
      if (img.dataset.fallback) return;
      img.dataset.fallback = '1';
      img.src = PLACEHOLDER;
    });
    return img;
  }

  /* ---------- Data ---------- */
  function normalizeRow(raw) {
    const row = {};
    for (const [k, v] of Object.entries(raw)) row[String(k).trim().toLowerCase()] = String(v ?? '').trim();
    const name = row.name;
    if (!name) return null;
    return {
      name,
      price: parsePrice(row.price),
      category: row.category || 'Other',
      sizes: parseSizes(row.sizes),
      description: row.description || '',
      outOfStock: isOutOfStock(row.stockstatus),
      image: resolveImage(row.imagefile),
      imageFile: imageFileName(row.imagefile),
    };
  }

  function loadCatalog() {
    showSkeleton();
    setStatus('Loading the collection...');

    if (!CONFIG.CSV_URL || CONFIG.CSV_URL.includes('PASTE_YOUR')) {
      showError('The product sheet link is not set yet. Add your published Google Sheet CSV link in script.js.');
      return;
    }

    Papa.parse(CONFIG.CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (s) => s.trim(),
      complete: (res) => {
        const fields = (res.meta.fields || []).map((f) => f.toLowerCase());
        if (!fields.includes('name') || !fields.includes('price')) {
          showError('The sheet is not published as CSV or is missing the Name and Price columns.');
          return;
        }
        state.products = res.data.map(normalizeRow).filter(Boolean);
        buildFilters();
        render();
      },
      error: () => showError('We could not load the collection. Check your connection and try again.'),
    });
  }

  /* ---------- Rendering ---------- */
  function setStatus(msg, isError = false) {
    els.status.className = 'status' + (isError ? ' is-error' : '');
    els.status.replaceChildren(msg);
  }

  function showError(msg) {
    els.grid.replaceChildren();
    els.grid.setAttribute('aria-busy', 'false');
    els.status.className = 'status is-error';
    els.status.replaceChildren(msg + ' ', h('button', { type: 'button', onclick: loadCatalog, text: 'Try again' }));
  }

  function showSkeleton() {
    els.grid.setAttribute('aria-busy', 'true');
    els.grid.replaceChildren(
      ...Array.from({ length: 8 }, () =>
        h('div', { class: 'card skeleton', 'aria-hidden': 'true' },
          h('div', { class: 'card-media' }),
          h('div', { class: 'card-body' },
            h('div', { class: 'line mid' }),
            h('div', { class: 'line short' })))
      )
    );
  }

  function buildFilters() {
    const cats = ['All', ...new Set(state.products.map((p) => p.category))];
    els.filters.replaceChildren(
      ...cats.map((c) =>
        h('button', {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(c === state.category),
          text: c,
          onclick: () => {
            state.category = c;
            els.filters.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === c)));
            render();
          },
        })
      )
    );
  }

  function visibleProducts() {
    const q = state.query.trim().toLowerCase();
    return state.products.filter((p) => {
      if (state.category !== 'All' && p.category !== state.category) return false;
      if (!q) return true;
      return (p.name + ' ' + p.category + ' ' + p.description).toLowerCase().includes(q);
    });
  }

  function render() {
    const list = visibleProducts();
    els.grid.setAttribute('aria-busy', 'false');
    els.grid.replaceChildren(...list.map(card));

    if (!state.products.length) {
      setStatus('No products are listed yet. Please check back soon.');
    } else if (!list.length) {
      setStatus('Nothing matches that search. Try another word or choose All.');
    } else {
      setStatus(`Showing ${list.length} of ${state.products.length} ${state.products.length === 1 ? 'piece' : 'pieces'}`);
    }
  }

  function card(p) {
    const media = h('span', { class: 'card-media' }, makeImage(p.image, p.name, true));
    if (p.outOfStock) media.append(h('span', { class: 'badge', text: 'Out of stock' }));

    return h('button', {
      type: 'button',
      class: 'card' + (p.outOfStock ? ' is-out' : ''),
      'aria-label': `${p.name}, ${formatINR(p.price)}${p.outOfStock ? ', out of stock' : ''}. View details`,
      onclick: () => openModal(p),
    },
      media,
      h('span', { class: 'card-body' },
        h('span', { class: 'card-name', text: p.name }),
        h('span', { class: 'card-price', text: formatINR(p.price) }),
        p.sizes.length ? h('span', { class: 'card-sizes', text: 'Sizes: ' + p.sizes.join(', ') }) : null));
  }

  /* ---------- Modal ---------- */
  function whatsappLink(p, size) {
    const lines = p.outOfStock
      ? [`Hi ${CONFIG.STORE_NAME}, is this piece coming back in stock?`, '', `Product: ${p.name}`]
      : [`Hi ${CONFIG.STORE_NAME}, I'd like to order:`, '', `Product: ${p.name}`];
    if (size) lines.push(`Size: ${size}`);
    lines.push(`Price: ${formatINR(p.price)}`);
    if (p.imageFile) lines.push(`Ref: ${p.imageFile}`);
    if (!p.outOfStock) lines.push('', 'Please confirm availability and delivery details.');
    return `https://wa.me/${CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  function needsSize(p) {
    return !p.outOfStock && p.sizes.length > 0;
  }

  function updateOrderButton() {
    const p = state.current;
    if (!p) return;
    const blocked = needsSize(p) && !state.selectedSize;
    els.mOrder.setAttribute('aria-disabled', String(blocked));
    els.mOrder.href = blocked ? '#' : whatsappLink(p, state.selectedSize);
    els.mOrder.textContent = p.outOfStock ? 'Ask when it is back' : 'Order on WhatsApp';
    if (!blocked) els.mHint.textContent = '';
  }

  function openModal(p) {
    state.current = p;
    state.selectedSize = '';

    els.mImg.dataset.fallback = '';
    els.mImg.onerror = () => {
      if (els.mImg.dataset.fallback) return;
      els.mImg.dataset.fallback = '1';
      els.mImg.src = PLACEHOLDER;
    };
    els.mImg.src = p.image;
    els.mImg.alt = p.name;

    els.mCat.textContent = p.category;
    els.mTitle.textContent = p.name;
    els.mPrice.textContent = formatINR(p.price);
    els.mStock.hidden = !p.outOfStock;
    els.mDesc.textContent = p.description;
    els.mDesc.hidden = !p.description;
    els.mHint.textContent = '';

    const showSizes = p.sizes.length > 0 && !p.outOfStock;
    els.mSizes.hidden = !showSizes;
    els.mSizeList.replaceChildren(
      ...(showSizes ? p.sizes : []).map((s) => {
        const input = h('input', { type: 'radio', name: 'size', value: s });
        input.addEventListener('change', () => {
          state.selectedSize = s;
          updateOrderButton();
        });
        return h('label', { class: 'size-opt' }, input, h('span', { class: 'size-label', text: s }));
      })
    );

    updateOrderButton();
    document.body.style.overflow = 'hidden';
    els.modal.showModal();
    els.modal.querySelector('.modal-inner').scrollTop = 0;
  }

  els.mOrder.addEventListener('click', (e) => {
    if (els.mOrder.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      els.mHint.textContent = 'Choose a size to continue.';
    }
  });

  els.mClose.addEventListener('click', () => els.modal.close());
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) els.modal.close();
  });
  els.modal.addEventListener('close', () => {
    document.body.style.overflow = '';
    state.current = null;
  });

  /* ---------- Init ---------- */
  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    if (state.products.length) render();
  });

  // Hide the logo cleanly if the file is not uploaded yet
  const logo = document.querySelector('.brand-logo');
  if (logo) {
    const hideLogo = () => { logo.hidden = true; };
    logo.addEventListener('error', hideLogo);
    if (logo.complete && logo.naturalWidth === 0) hideLogo();
  }

  $('year').textContent = new Date().getFullYear();
  $('footer-wa').href = `https://wa.me/${CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi ' + CONFIG.STORE_NAME + ', I have a question.')}`;

  loadCatalog();
})();
