/* Walking router that runs entirely in the browser.
   Reads the prebuilt Almaty walking network (data/graph.bin): every street segment carries two times,
   one for each direction, computed with Tobler's hiking function from the terrain slope.
   Nothing the user enters is sent anywhere: the points stay in this page's memory. */
const Router = (() => {
  let G = null;
  const KX = 111320 * Math.cos(43.25 * Math.PI / 180), KY = 110950;
  const V0 = 4.8 / 3.6; // m/s on flat ground

  async function load(url) {
    const buf = await (await fetch(url)).arrayBuffer();
    const h = new Uint32Array(buf, 0, 4); const [nN, nE, nG] = h;
    let o = 16;
    const lat = new Int32Array(buf, o, nN); o += nN * 4;
    const lon = new Int32Array(buf, o, nN); o += nN * 4;
    const z = new Int16Array(buf, o, nN); o += nN * 2 + (nN % 2 ? 2 : 0);
    const ef = new Uint32Array(buf, o, nE); o += nE * 4;
    const et = new Uint32Array(buf, o, nE); o += nE * 4;
    const tf = new Uint16Array(buf, o, nE); o += nE * 2;
    const tb = new Uint16Array(buf, o, nE); o += nE * 2;
    const len = new Uint16Array(buf, o, nE); o += nE * 2 + (nE % 2 ? 2 : 0);
    const g0 = new Uint32Array(buf, o, nE); o += nE * 4;
    const gn = new Uint16Array(buf, o, nE); o += nE * 2 + (nE % 2 ? 2 : 0);
    const glat = new Int32Array(buf, o, nG); o += nG * 4;
    const glon = new Int32Array(buf, o, nG);
    const S = 43.15, W = 76.68;
    const y = new Float64Array(nN), x = new Float64Array(nN);
    for (let i = 0; i < nN; i++) { y[i] = S + lat[i] / 1e6; x[i] = W + lon[i] / 1e6; }
    // adjacency (CSR): for node u, arcs to v with cost there (u->v) and edge id
    const deg = new Uint32Array(nN + 1);
    for (let e = 0; e < nE; e++) { deg[ef[e] + 1]++; deg[et[e] + 1]++; }
    for (let i = 0; i < nN; i++) deg[i + 1] += deg[i];
    const fill = deg.slice(0, nN);
    const to = new Uint32Array(2 * nE), cost = new Float32Array(2 * nE), rcost = new Float32Array(2 * nE), eid = new Int32Array(2 * nE);
    for (let e = 0; e < nE; e++) {
      const u = ef[e], v = et[e], a = tf[e] / 10, b = tb[e] / 10;
      let k = fill[u]++; to[k] = v; cost[k] = a; rcost[k] = b; eid[k] = e;     // u->v costs a, v->u costs b
      k = fill[v]++; to[k] = u; cost[k] = b; rcost[k] = a; eid[k] = -e - 1;     // negative id = traversed v->u
    }
    // grid for nearest-node lookup
    const cell = 0.003, grid = new Map();
    for (let i = 0; i < nN; i++) {
      const key = Math.floor(y[i] / cell) * 100000 + Math.floor(x[i] / cell);
      let a = grid.get(key); if (!a) grid.set(key, a = []); a.push(i);
    }
    G = { nN, nE, y, x, z, ef, et, len, g0, gn, glat, glon, S, W, off: deg, to, cost, rcost, eid, grid, cell };
    return G;
  }

  function nearest(lat, lng) {
    const { grid, cell, y, x } = G; const cy = Math.floor(lat / cell), cx = Math.floor(lng / cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 3 && best < 0; r++)
      for (let i = cy - r; i <= cy + r; i++) for (let j = cx - r; j <= cx + r; j++) {
        const a = grid.get(i * 100000 + j); if (!a) continue;
        for (const n of a) { const d = Math.hypot((x[n] - lng) * KX, (y[n] - lat) * KY); if (d < bd) { bd = d; best = n; } }
      }
    return best < 0 ? null : { node: best, dist: bd };
  }

  // Dijkstra with a binary heap, bounded by maxSec. reverse=true gives time FROM every node TO the source.
  function search(src, startSec, maxSec, reverse) {
    const { nN, off, to, cost, rcost } = G; const c = reverse ? rcost : cost;
    const dist = new Float64Array(nN).fill(Infinity), prev = new Int32Array(nN).fill(-1);
    const hk = [], hv = [];
    const push = (k, v) => { hk.push(k); hv.push(v); let i = hk.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
    const pop = () => { const v = hv[0], k = hk.pop(), w = hv.pop(); const n = hk.length; if (n) { let i = 0; for (;;) { let l = 2 * i + 1; if (l >= n) break; if (l + 1 < n && hk[l + 1] < hk[l]) l++; if (hk[l] >= k) break; hk[i] = hk[l]; hv[i] = hv[l]; i = l; } hk[i] = k; hv[i] = w; } return v; };
    dist[src] = startSec; push(startSec, src);
    while (hk.length) {
      const d0 = hk[0], u = pop(); if (d0 > dist[u]) continue; if (d0 > maxSec) break;
      for (let k = off[u]; k < off[u + 1]; k++) {
        const v = to[k], nd = d0 + c[k];
        if (nd < dist[v]) { dist[v] = nd; prev[v] = k; push(nd, v); }
      }
    }
    return { dist, prev };
  }

  // walk prev arcs back from target to the source; returns arcs in travel order (source -> target)
  function arcsTo(res, target) {
    const out = []; let n = target, guard = 0;
    while (res.prev[n] >= 0 && guard++ < 1e6) { const k = res.prev[n]; out.push(k); n = arcFrom(k); }
    return out.reverse();
  }
  function arcFrom(k) { const e = G.eid[k]; return e >= 0 ? G.ef[e] : G.et[-e - 1]; }

  // polyline (lat,lng pairs) for a list of arcs in travel order; also climb in metres
  function geometry(arcs, reversed) {
    const pts = []; let up = 0, down = 0, m = 0;
    const seq = reversed ? arcs.slice().reverse() : arcs;
    for (const k of seq) {
      const e0 = G.eid[k], e = e0 >= 0 ? e0 : -e0 - 1;
      let fwd = e0 >= 0; if (reversed) fwd = !fwd;
      const a = fwd ? G.ef[e] : G.et[e], b = fwd ? G.et[e] : G.ef[e];
      const inner = []; for (let i = 0; i < G.gn[e]; i++) { const j = G.g0[e] + i; inner.push([G.S + G.glat[j] / 1e6, G.W + G.glon[j] / 1e6]); }
      if (!fwd) inner.reverse();
      if (!pts.length) pts.push([G.y[a], G.x[a]]);
      pts.push(...inner, [G.y[b], G.x[b]]);
      const dz = G.z[b] - G.z[a]; if (dz > 0) up += dz; else down -= dz; m += G.len[e];
    }
    return { pts, up, down, m };
  }

  return { load, nearest, search, arcsTo, geometry, get G() { return G; }, KX, KY, V0 };
})();
