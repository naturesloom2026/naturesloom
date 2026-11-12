/* Natures Loom storefront
   Catalog comes from a published Google Sheet (CSV). Pictures live in ./images/.
   Layout and behaviour follow store.html: item pages, picture viewer, search and filters,
   WhatsApp enquiry. No backend is needed. */
(() => {
  'use strict';

  /* ================= CONFIG: edit these ================= */
  const CONFIG = {
    storeName: 'Natures Loom',
    // Google Sheets > File > Share > Publish to web > CSV > Publish, then paste the link here
    csvUrl: 'PASTE_YOUR_GOOGLE_SHEET_CSV_URL_HERE',
    whatsapp: '918088498045',   // country code + number, or a full wa.me link
    instagram: '',              // username or link; leave empty to hide the icon
    imageDir: './images/',
  };
  /* ====================================================== */

  const $ = (s) => document.querySelector(s);

  const ICONS = {
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><g transform="translate(6.96 6.7) scale(.42)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></g></svg>',
    instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/></svg>',
  };

  /* ---------- State ---------- */
  let items = [];
  let loaded = false;
  let query = '', catFilter = '', statusFilter = '';
  let lastScroll = 0;
  let lbList = [], lbIdx = 0, lbReturn = null;

  /* ---------- Small helpers ---------- */
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

  const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_\-]+/g, '');
  const isUrl = (s) => /^https?:\/\//i.test(s);

  const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

  function priceText(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    const n = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n)) return s; // text such as "Ask for price"
    return Number.isInteger(n) ? inr0.format(n) : inr2.format(n);
  }

  // Accepts "kurta-01.jpg", "images/kurta-01.jpg", "./images/kurta-01.jpg" or a full URL
  function resolveImage(value) {
    let f = String(value ?? '').trim();
    if (!f) return '';
    if (/^(https?:)?\/\//i.test(f) || f.startsWith('data:')) return f;
    f = f.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^images\//i, '');
    return CONFIG.imageDir + f.split('/').map(encodeURIComponent).join('/');
  }

  const splitList = (v) => String(v ?? '').split(/[\n,;|]+/).map((s) => s.trim()).filter(Boolean);

  function statusClass(s) {
    const x = String(s || '').toLowerCase();
    if (!x) return '';
    if (/sold|out of stock|unavailable|not available/.test(x)) return 'sold';
    if (/coming/.test(x)) return 'soon';
    if (/new/.test(x)) return 'new';
    if (/available|in stock/.test(x)) return 'ok';
    return '';
  }

  /* ---------- WhatsApp / Instagram links ---------- */
  function waBase() {
    const s = String(CONFIG.whatsapp || '').trim();
    if (!s) return '';
    if (isUrl(s)) return s;
    const d = s.replace(/\D/g, '');
    return d ? 'https://wa.me/' + d : '';
  }

  function waWithText(text) {
    const base = waBase();
    if (!base) return '';
    try {
      const u = new URL(base);
      if (/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/i.test(u.hostname)) {
        u.searchParams.set('text', text);
        return u.toString();
      }
    } catch (e) { /* fall through */ }
    return base;
  }

  function igLink(s) {
    s = String(s || '').trim();
    if (!s) return '';
    if (isUrl(s)) return s;
    if (/^(www\.)?instagram\.com\//i.test(s)) return 'https://' + s;
    const name = s.replace(/^@/, '').replace(/[^\w.]/g, '');
    return name ? 'https://instagram.com/' + name : '';
  }

  /* ---------- Header ---------- */
  function setupHeader() {
    const logo = $('#logo img');
    if (logo) {
      const ok = () => $('#top').classList.add('has-logo');
      const bad = () => logo.parentElement.remove();
      if (logo.complete) (logo.naturalWidth ? ok() : bad());
      else { logo.addEventListener('load', ok); logo.addEventListener('error', bad); }
    }
    const box = $('#social');
    box.replaceChildren();
    [
      ['whatsapp', 'WhatsApp', waWithText('Hi ' + CONFIG.storeName + '!')],
      ['instagram', 'Instagram', igLink(CONFIG.instagram)],
    ].forEach(([k, label, href]) => {
      if (!href) return;
      const a = h('a', { class: 'soc ' + k, href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label, title: label });
      a.innerHTML = ICONS[k];
      box.append(a);
    });
    $('#foot').textContent = '© ' + new Date().getFullYear() + ' ' + CONFIG.storeName;
  }

  /* ---------- Data ---------- */
  const KNOWN = new Set(['name', 'title', 'price', 'category', 'sizes', 'description', 'status', 'stockstatus', 'code', 'imagefile', 'moreimages']);
  // Never show columns that look like private business data, even if they end up in the published sheet
  const PRIVATE = /supplier|vendor|phone|mobile|contact|purchase|cost|buying|margin|profit/i;

  function normalizeRow(raw) {
    const row = {}, labels = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === '__parsed_extra') continue;
      const key = norm(k);
      if (!key) continue;
      row[key] = String(v ?? '').trim();
      labels[key] = String(k).trim();
    }
    const name = row.name || row.title;
    if (!name) return null;

    const status = row.status || row.stockstatus || '';
    const images = [...new Set([row.imagefile, ...splitList(row.moreimages)].filter(Boolean).map(resolveImage))];
    const specs = Object.keys(row)
      .filter((k) => !KNOWN.has(k) && row[k] && !PRIVATE.test(labels[k]))
      .map((k) => ({ label: labels[k], value: row[k] }));

    return {
      name,
      price: priceText(row.price),
      category: row.category || '',
      sizes: splitList(row.sizes),
      description: row.description || '',
      status,
      sold: statusClass(status) === 'sold',
      code: row.code || '',
      images,
      specs,
    };
  }

  function assignSlugs(list) {
    const used = new Set();
    list.forEach((it) => {
      const base = (it.code || it.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
      let s = base, n = 2;
      while (used.has(s)) s = base + '-' + n++;
      used.add(s);
      it.slug = s;
    });
  }

  function loadCatalog() {
    renderSkeleton();
    if (!CONFIG.csvUrl || CONFIG.csvUrl.includes('PASTE_YOUR')) {
      showError('The product sheet link is not set yet. Add your published Google Sheet CSV link in script.js.');
      return;
    }
    Papa.parse(CONFIG.csvUrl, {
      download: true,
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (s) => s.trim(),
      complete: (res) => {
        const fields = (res.meta.fields || []).map(norm);
        if (!fields.includes('name') && !fields.includes('title')) {
          showError('The sheet is not published as CSV, or the Name column is missing.');
          return;
        }
        items = res.data.map(normalizeRow).filter(Boolean);
        assignSlugs(items);
        loaded = true;
        route();
      },
      error: () => showError('We could not load the collection. Check your connection and try again.'),
    });
  }

  /* ---------- Views ---------- */
  function showError(msg) {
    loaded = false;
    $('#view').replaceChildren(
      h('div', { id: 'msg', class: 'err', role: 'alert' }, msg + ' ', h('button', { type: 'button', onclick: loadCatalog, text: 'Try again' }))
    );
  }

  function renderSkeleton() {
    const grid = h('div', { class: 'grid', 'aria-hidden': 'true' },
      ...Array.from({ length: 8 }, () =>
        h('div', { class: 'card skeleton' },
          h('div', { class: 'ph' }),
          h('div', { class: 'meta' }, h('div', { class: 'line m' }), h('div', { class: 'line s' })))));
    $('#view').replaceChildren(h('div', { id: 'msg', role: 'status', text: 'Loading the collection…' }), grid);
    $('#view').setAttribute('aria-busy', 'true');
  }

  function pic(src, alt, lazy) {
    if (!src) return h('div', { class: 'ph', text: 'Photo coming soon' });
    const img = h('img', { src, alt, decoding: 'async', loading: lazy ? 'lazy' : null });
    img.addEventListener('error', () => img.replaceWith(h('div', { class: 'ph', text: 'Photo coming soon' })), { once: true });
    return img;
  }

  /* ----- Home ----- */
  function home() {
    const v = $('#view');
    v.removeAttribute('aria-busy');
    if (!items.length) {
      v.replaceChildren(h('div', { id: 'msg', text: 'No items yet. Please check back soon.' }));
      return;
    }

    const cats = [...new Set(items.map((i) => i.category).filter(Boolean))];
    const stats = [...new Set(items.map((i) => i.status).filter(Boolean))];

    const q = h('input', { id: 'q', type: 'search', placeholder: 'Search by code or name', 'aria-label': 'Search by code or name', autocomplete: 'off' });
    const cf = cats.length > 1 ? h('select', { 'aria-label': 'Filter by category' }) : null;
    const sf = stats.length ? h('select', { 'aria-label': 'Filter by status' }) : null;
    const count = h('div', { id: 'count', class: 'count', role: 'status', 'aria-live': 'polite' });
    const grid = h('div', { class: 'grid', id: 'grid' });

    if (cf) { cf.add(new Option('All categories', '')); cats.forEach((c) => cf.add(new Option(c, c))); cf.value = cats.includes(catFilter) ? catFilter : ''; catFilter = cf.value; }
    if (sf) { sf.add(new Option('All statuses', '')); stats.forEach((s) => sf.add(new Option(s, s))); sf.value = stats.includes(statusFilter) ? statusFilter : ''; statusFilter = sf.value; }
    if (!cf) catFilter = '';
    if (!sf) statusFilter = '';
    q.value = query;

    v.replaceChildren(h('div', { class: 'search' }, q, cf, sf), count, grid);

    const draw = () => {
      query = q.value;
      if (cf) catFilter = cf.value;
      if (sf) statusFilter = sf.value;
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      grid.replaceChildren();
      let shown = 0;
      items.forEach((it) => {
        if (catFilter && it.category !== catFilter) return;
        if (statusFilter && it.status !== statusFilter) return;
        const hay = [it.code, it.name, it.description, it.price, it.status, it.category, it.sizes.join(' '), it.specs.map((s) => s.value).join(' ')].join(' ').toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return;
        shown++;
        const n = it.images.length;
        const card = h('a', { href: '#item/' + it.slug, class: 'card' + (it.sold ? ' sold-out' : ''), 'aria-label': it.name + (it.price ? ', ' + it.price : '') + (it.status ? ', ' + it.status : '') },
          pic(it.images[0], it.name, true),
          it.status ? h('span', { class: 'badge ' + statusClass(it.status), text: it.status }) : null,
          h('div', { class: 'meta' },
            h('div', { class: 't', text: it.name }),
            it.code ? h('div', { class: 'code', text: 'Code: ' + it.code }) : null,
            it.price ? h('div', { class: 'p', text: it.price }) : null,
            n > 1 ? h('div', { class: 'count', text: n + ' pictures' }) : null));
        grid.append(card);
      });
      const filtered = terms.length || catFilter || statusFilter;
      count.textContent = filtered ? (shown ? shown + ' of ' + items.length + ' items' : 'No items match. Try another word or clear the filters.') : '';
    };

    q.addEventListener('input', draw);
    if (cf) cf.addEventListener('change', draw);
    if (sf) sf.addEventListener('change', draw);
    q.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const cards = grid.querySelectorAll('a.card');
      if (cards.length === 1) location.hash = cards[0].getAttribute('href');
      else q.blur();
    });
    draw();
  }

  /* ----- Item page ----- */
  function enquiry(it, size) {
    const bits = [];
    if (it.code) bits.push('Code: ' + it.code);
    if (size) bits.push('Size: ' + size);
    if (it.price) bits.push('Price: ' + it.price);
    const what = '“' + it.name + '”' + (bits.length ? ' (' + bits.join(', ') + ')' : '');
    let msg = it.sold
      ? 'Hi ' + CONFIG.storeName + '! Is ' + what + ' coming back in stock?'
      : 'Hi ' + CONFIG.storeName + '! I\'m interested in ' + what + '.';
    if (/^https?:$/.test(location.protocol)) msg += '\n' + location.href;
    return waWithText(msg);
  }

  function detail(slug) {
    const it = items.find((x) => x.slug === slug);
    const v = $('#view');
    v.removeAttribute('aria-busy');
    if (!it) { location.hash = ''; return; }

    v.innerHTML = '<a class="back" href="#">‹ Back to all items</a>' +
      '<div class="detail"><h2></h2><div class="status"></div><div class="code"></div><div class="price"></div>' +
      '<div class="specs"></div><p class="desc"></p><div class="sizes-slot"></div><div class="enq"></div><div class="hint" role="status" aria-live="polite"></div>' +
      '<div class="grid" id="shots"></div></div>';

    v.querySelector('h2').textContent = it.name;
    if (it.status) {
      const st = v.querySelector('.status');
      st.append(h('span', { class: 'badge inline ' + statusClass(it.status), text: it.status }));
    }
    v.querySelector('.code').textContent = it.code ? 'Code: ' + it.code : '';
    v.querySelector('.price').textContent = it.price;
    v.querySelector('.desc').textContent = it.description;
    v.querySelector('.desc').hidden = !it.description;

    const sp = v.querySelector('.specs');
    const rows = (it.category ? [{ label: 'Category', value: it.category }] : []).concat(it.specs);
    rows.forEach((r) => sp.append(h('span', {}, h('b', { text: r.label + ': ' }), r.value)));

    // Size selector (only when the sheet lists sizes and the piece is not sold)
    const needsSize = it.sizes.length > 0 && !it.sold;
    let size = '';
    const hint = v.querySelector('.hint');
    const slot = v.querySelector('.enq');
    const order = h('a', { class: 'btn-wa', target: '_blank', rel: 'noopener noreferrer' });
    order.innerHTML = ICONS.whatsapp + '<span></span>';
    const label = it.sold ? 'Ask if it\'s coming back' : (statusClass(it.status) === 'soon' ? 'Enquire on WhatsApp' : 'Order on WhatsApp');
    order.lastChild.textContent = label;

    const refresh = () => {
      const blocked = needsSize && !size;
      order.setAttribute('aria-disabled', String(blocked));
      order.href = blocked ? '#' : (enquiry(it, size) || '#');
      if (!blocked) hint.textContent = '';
    };

    if (needsSize) {
      const list = h('div', { class: 'size-list' });
      it.sizes.forEach((s) => {
        const input = h('input', { type: 'radio', name: 'size', value: s });
        input.addEventListener('change', () => { size = s; refresh(); });
        list.append(h('label', { class: 'size-opt' }, input, h('span', { text: s })));
      });
      v.querySelector('.sizes-slot').append(h('fieldset', { class: 'sizes' }, h('legend', { text: 'Choose a size' }), list));
    }

    order.addEventListener('click', (e) => {
      if (order.getAttribute('aria-disabled') === 'true') {
        e.preventDefault();
        hint.textContent = 'Choose a size to continue.';
      }
    });
    if (waBase()) { slot.append(order); refresh(); }

    document.title = it.name + ' – ' + CONFIG.storeName;

    // Pictures
    const grid = v.querySelector('#shots');
    const failed = new Set();
    if (!it.images.length) grid.append(h('div', { class: 'ph', text: 'Photo coming soon' }));
    it.images.forEach((src) => {
      const img = h('img', { src, alt: it.name, decoding: 'async', loading: 'lazy' });
      const btn = h('button', { type: 'button', class: 'shot', 'aria-label': 'View larger picture of ' + it.name }, img);
      img.addEventListener('error', () => {
        failed.add(src);
        btn.replaceWith(h('div', { class: 'ph', text: 'Photo coming soon' }));
      }, { once: true });
      btn.addEventListener('click', () => {
        const ok = it.images.filter((s) => !failed.has(s));
        openLb(ok, ok.indexOf(src), btn);
      });
      grid.append(btn);
    });
  }

  /* ---------- Lightbox ---------- */
  function showLb() { $('#lb img').src = lbList[lbIdx]; }
  function openLb(list, idx, from) {
    if (!list.length) return;
    lbList = list; lbIdx = Math.max(0, idx); lbReturn = from || null;
    $('#lb').classList.toggle('single', list.length < 2);
    showLb();
    $('#lb').classList.add('on');
    $('#lb .x').focus();
  }
  function closeLb() {
    $('#lb').classList.remove('on');
    if (lbReturn && document.contains(lbReturn)) lbReturn.focus();
    lbReturn = null;
  }
  function step(d) {
    if (lbList.length < 2) return;
    lbIdx = (lbIdx + d + lbList.length) % lbList.length;
    showLb();
  }
  $('#lb').addEventListener('click', (e) => {
    const c = e.target.className;
    if (c === 'x' || e.target.id === 'lb') closeLb();
    else if (c === 'pv') step(-1);
    else if (c === 'nx') step(1);
  });
  document.addEventListener('keydown', (e) => {
    if (!$('#lb').classList.contains('on')) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  /* ---------- Routing ---------- */
  function route() {
    if (!loaded) return;
    $('#lb').classList.remove('on');
    const m = location.hash.match(/^#item\/([\w-]+)$/);
    if (m) {
      detail(m[1]);
      window.scrollTo(0, 0);
    } else {
      document.title = CONFIG.storeName;
      home();
      window.scrollTo(0, lastScroll);
    }
  }
  window.addEventListener('scroll', () => { if (!location.hash) lastScroll = window.scrollY; }, { passive: true });
  window.addEventListener('hashchange', route);

  /* ---------- Start ---------- */
  setupHeader();
  loadCatalog();
})();
