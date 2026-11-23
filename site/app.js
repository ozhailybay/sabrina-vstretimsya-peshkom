/* The tool page: two points, one search, a fair meeting place. Everything happens in this tab. */
(() => {
  const T = I18N.t;
  const LIMIT = 15 * 60, CAP = 30 * 60;
  const DIST_EN = { 'Бостандыкский район': 'Bostandyk', 'Ауэзовский район': 'Auezov', 'Жетысуский район': 'Zhetysu', 'Наурызбайский район': 'Nauryzbay',
    'Алмалинский район': 'Almaly', 'Алатауский район': 'Alatau', 'Турксибский район': 'Turksib', 'Медеуский район': 'Medeu' };
  const DEMOS = [
    { a: [43.2261, 76.9103], b: [43.2247, 76.9279] },
    { a: [43.2600, 76.9461], b: [43.2565, 76.9649] },
    { a: [43.3050, 76.8450], b: [43.2050, 77.0000] },
  ];
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const pts = { a: null, b: null }, markers = { a: null, b: null };
  let city = null, active = 'a', kind = 'all', layer = null, last = null, sel = 0;

  const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([43.238, 76.92], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'base-tiles',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
  const pinIcon = p => L.divIcon({ className: '', html: `<div class="pin ${p}"><span>${p.toUpperCase()}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30] });

  Promise.all([Router.load('data/graph.bin?v=2'), fetch('data/city.json?v=2').then(r => r.json())]).then(([, c]) => {
    city = c; $('#loading').remove(); fillInputs(); setActive('a'); I18N.on(() => { fillDistricts(); renderStates(); if (last) render(last); });
  }).catch(() => { $('#loading').textContent = T('Не удалось загрузить карту улиц. Обновите страницу.', 'Could not load the street map. Please reload the page.'); });

  function fillInputs() {
    fillDistricts();
    $('#streets').innerHTML = city.streets.map(s => `<option value="${esc(s[0])}"></option>`).join('');
  }
  function fillDistricts() {
    if (!city) return;
    const opts = `<option value="">${T('Выбрать…', 'Choose…')}</option>` + city.districts.map((d, i) => [d, i])
      .sort((x, y) => dname(x[0]).localeCompare(dname(y[0]))).map(([d, i]) => `<option value="${i}">${esc(dname(d))}</option>`).join('');
    $$('[data-dist]').forEach(s => { const v = s.value; s.innerHTML = opts; s.value = v; });
  }
  const dname = d => I18N.lang === 'en' ? (DIST_EN[d.n] || d.n) + ' District' : d.n;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function setActive(p) {
    active = p; $$('.person').forEach(el => el.classList.toggle('active', el.dataset.p === p));
    map.getContainer().style.cursor = 'crosshair';
  }
  function setPoint(p, lat, lng, how, zoom) {
    if (!(lat > 43.15 && lat < 43.40 && lng > 76.68 && lng < 77.10)) { flash(p, T('эта точка вне Алматы', 'this point is outside Almaty')); return; }
    pts[p] = { lat, lng, how };
    if (!markers[p]) {
      markers[p] = L.marker([lat, lng], { icon: pinIcon(p), draggable: true, keyboard: true }).addTo(map);
      markers[p].on('dragend', e => { const ll = e.target.getLatLng(); setPoint(p, ll.lat, ll.lng, 'drag'); });
    } else markers[p].setLatLng([lat, lng]);
    if (zoom) map.setView([lat, lng], Math.max(map.getZoom(), 14));
    clearResult(); renderStates();
    if (p === 'a' && !pts.b) setActive('b'); else if (p === 'b' && !pts.a) setActive('a');
  }
  function renderStates() {
    for (const p of ['a', 'b']) {
      const el = $('#state' + p.toUpperCase()), q = pts[p];
      el.classList.toggle('ok', !!q);
      el.textContent = !q ? T('точки пока нет', 'no point yet') : q.how === 'district' ? T('центр района', 'district centre') : q.how === 'street' ? T('середина улицы', 'middle of the street') : T('точка отмечена', 'point set');
    }
    $('#go').disabled = !(pts.a && pts.b && city);
  }
  function flash(p, msg) { const el = $('#state' + p.toUpperCase()); el.textContent = msg; el.classList.remove('ok'); }

  map.on('click', e => setPoint(active, e.latlng.lat, e.latlng.lng, 'tap'));
  $$('[data-tap]').forEach(b => b.addEventListener('click', () => setActive(b.dataset.tap)));
  $$('.person').forEach(el => el.addEventListener('focusin', () => setActive(el.dataset.p)));
  $$('[data-dist]').forEach(s => s.addEventListener('change', () => {
    if (s.value === '') return; const d = city.districts[+s.value], p = s.dataset.dist;
    const c = ringCentre(d.ring), n = Router.nearest(c[0], c[1]); const G = Router.G;
    map.fitBounds([[d.b[0], d.b[1]], [d.b[2], d.b[3]]], { padding: [20, 20] });
    setPoint(p, G.y[n.node], G.x[n.node], 'district');
  }));
  $$('[data-str]').forEach(inp => inp.addEventListener('change', () => {
    const v = inp.value.trim().toLowerCase(); if (!v) return;
    const size = x => (x[5] - x[3]) * Router.KY + (x[6] - x[4]) * Router.KX;
    const s = city.streets.find(x => x[0].toLowerCase() === v) ||
      city.streets.filter(x => x[0].toLowerCase().includes(v)).sort((x, y) => size(y) - size(x))[0];
    if (!s) { flash(inp.dataset.str, T('такой улицы нет в списке', 'street not found')); return; }
    inp.value = s[0];
    if (size(s) > 50) map.fitBounds([[s[3], s[4]], [s[5], s[6]]], { padding: [30, 30], maxZoom: 16 }); else map.setView([s[1], s[2]], 16);
    setPoint(inp.dataset.str, s[1], s[2], 'street');
  }));
  $$('[data-kind]').forEach(b => b.addEventListener('click', () => {
    kind = b.dataset.kind; $$('[data-kind]').forEach(x => x.setAttribute('aria-pressed', x === b)); if (last) run();
  }));
  $$('[data-demo]').forEach(b => b.addEventListener('click', () => {
    if (!city) return; const d = DEMOS[+b.dataset.demo];
    setPoint('a', d.a[0], d.a[1], 'tap'); setPoint('b', d.b[0], d.b[1], 'tap');
    map.fitBounds([d.a, d.b], { padding: [60, 60] }); run();
  }));
  $('#go').addEventListener('click', run);

  function ringCentre(r) { let y = 0, x = 0; for (const p of r) { y += p[0]; x += p[1]; } return [y / r.length, x / r.length]; }
  function clearResult() { last = null; layer.clearLayers(); $('#results').innerHTML = ''; }

  function run() {
    if (!(pts.a && pts.b)) return;
    $('#results').innerHTML = `<h2>${T('Считаю маршруты…', 'Walking every street…')}</h2><div class="skel"></div><div class="skel"></div><div class="skel"></div>`;
    setTimeout(() => { last = compute(); sel = 0; render(last); }, 30);
  }

  function compute() {
    const out = {};
    for (const p of ['a', 'b']) {
      const q = pts[p], n = Router.nearest(q.lat, q.lng); const leg = n.dist / Router.V0;
      out[p] = { snap: n, leg, fwd: Router.search(n.node, leg, CAP, false), rev: Router.search(n.node, leg, CAP, true) };
    }
    const list = [];
    for (const pl of city.places) {
      if (kind !== 'all' && pl.k !== kind) continue;
      const r = { pl };
      for (const p of ['a', 'b']) {
        let best = Infinity, bn = -1, home = Infinity;
        for (const n of pl.acc) { const t = out[p].fwd.dist[n]; if (t < best) { best = t; bn = n; } home = Math.min(home, out[p].rev.dist[n]); }
        r[p] = { t: best, node: bn, home };
      }
      if (isFinite(r.a.t) && isFinite(r.b.t)) list.push(r);
    }
    list.sort((x, y) => Math.max(x.a.t, x.b.t) - Math.max(y.a.t, y.b.t) || (x.a.t + x.b.t) - (y.a.t + y.b.t));
    const ok = list.filter(r => r.a.t <= LIMIT && r.b.t <= LIMIT);
    const straight = Math.hypot((pts.a.lng - pts.b.lng) * Router.KX, (pts.a.lat - pts.b.lat) * Router.KY);
    return { out, ok: ok.slice(0, 6), near: ok.length ? [] : list.slice(0, 3), straight };
  }

  const mins = s => Math.max(1, Math.round(s / 60));
  const kindName = k => k === 'park' ? T('парк', 'park') : T('библиотека', 'library');
  const plName = pl => pl.n || (pl.k === 'park' ? T('Парк без названия', 'Unnamed park') : T('Библиотека', 'Library'));

  function render(res) {
    const box = $('#results'); const rows = res.ok.length ? res.ok : res.near;
    if (!rows.length) {
      box.innerHTML = `<div class="empty"><b>${T('Общего места не нашлось.', 'No shared place found.')}</b><br>${T(`Между вами ${(res.straight / 1000).toFixed(1).replace('.', ',')} км по прямой. Пешком за 30 минут ни один парк или библиотека не доступны обоим. Попробуйте точку ближе или другой тип места.`, `You are ${(res.straight / 1000).toFixed(1)} km apart in a straight line. No park or library is within a 30-minute walk for both of you. Try a closer point or another kind of place.`)}</div>`;
      layer.clearLayers(); return;
    }
    const head = res.ok.length
      ? T(`Оба дойдут за 15 минут: ${res.ok.length === 6 ? 'лучшие 6' : res.ok.length}`, `Both of you within 15 minutes: ${res.ok.length === 6 ? 'top 6' : res.ok.length}`)
      : T('За 15 минут общего места нет. Ближайшие честные варианты:', 'No shared place within 15 minutes. The fairest nearby options:');
    box.innerHTML = `<h2>${head}</h2><ul class="res">` + rows.map((r, i) => `
      <li tabindex="0" data-i="${i}" style="--i:${i}" class="${i === sel ? 'sel' : ''}">
        <div class="t"><b>${esc(plName(r.pl))}</b><span class="kind">${kindName(r.pl.k)}</span></div>
        <div class="times">${['a', 'b'].map(p => `<div class="time" data-p="${p}"><div class="who"><i></i>${p.toUpperCase()} ${T('туда', 'there')}</div>
          <div class="m num">${mins(r[p].t)}<small> ${T('мин', 'min')}</small></div>
          <div class="back">${T('домой', 'home')} <span class="num">${mins(r[p].home)}</span> ${T('мин', 'min')}</div></div>`).join('')}</div>
      </li>`).join('') + '</ul>';
    $$('.res li').forEach(li => { const f = () => { sel = +li.dataset.i; render(res); }; li.addEventListener('click', f); li.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
    draw(res, rows[sel]);
  }

  function draw(res, r) {
    layer.clearLayers(); const bounds = [];
    if (r.pl.ring) L.polygon(r.pl.ring, { color: '#2E6A4E', weight: 1.5, fillColor: '#2E6A4E', fillOpacity: .12 }).addTo(layer);
    for (const p of ['a', 'b']) {
      const o = res.out[p], arcs = Router.arcsTo(o.fwd, r[p].node), g = Router.geometry(arcs, false), G = Router.G;
      const col = p === 'a' ? '#2E6A4E' : '#B8552F';
      const start = [G.y[o.snap.node], G.x[o.snap.node]];
      L.polyline([[pts[p].lat, pts[p].lng], start], { color: col, weight: 3, dashArray: '4 6', opacity: .8 }).addTo(layer);
      if (g.pts.length) L.polyline(g.pts, { color: '#fff', weight: 8, opacity: .9 }).addTo(layer), L.polyline(g.pts, { color: col, weight: 4.5, opacity: 1 }).addTo(layer);
      bounds.push([pts[p].lat, pts[p].lng], ...g.pts);
      const tip = `${p.toUpperCase()}: ${mins(r[p].t)} ${T('мин туда', 'min there')}, ${mins(r[p].home)} ${T('мин домой', 'min home')} · ${(g.m / 1000).toFixed(1)} ${T('км', 'km')} · ${T('подъём', 'climb')} ${Math.round(g.up)} ${T('м', 'm')}`;
      markers[p].bindTooltip(tip, { direction: 'top', offset: [0, -30] });
    }
    const G = Router.G, gn = r.a.node;
    L.marker([G.y[gn], G.x[gn]], { icon: L.divIcon({ className: '', html: '<div class="goal"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) })
      .bindTooltip(esc(plName(r.pl)), { direction: 'top', offset: [0, -12], permanent: true }).addTo(layer);
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }
})();
