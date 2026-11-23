"""Build the data the site uses: Almaty walking network with Tobler walking times, parks, libraries,
districts, street names. Runs once on the builder's computer; the site only reads the output files.
Written by the ADMIT mentor with an AI assistant (Claude). Method follows Sabrina's slope study:
OpenStreetMap walking network, Copernicus DEM GLO-30 smoothed ~60 m, Tobler's hiking function
scaled to 4.8 km/h on flat ground (15 min = 1.2 km, as in her CASJ paper)."""
import json, math, struct, sys, glob
import numpy as np, rasterio
from rasterio.merge import merge
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import cKDTree

OUT = sys.argv[1] if len(sys.argv) > 1 else '../site/data'
S, W, N, E = 43.15, 76.68, 43.40, 77.10
LAT0 = 43.25; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110950
NO_WALK = {'motorway', 'motorway_link', 'construction', 'proposed', 'abandoned', 'razed', 'raceway',
           'bus_guideway', 'escape', 'no', 'disused', 'platform'}
V0 = 4.8 / 3.6  # m/s on flat ground

def tobler_rel(s):
    return np.exp(-3.5 * np.abs(s + 0.05)) / math.exp(-3.5 * 0.05)

# ---------- elevation ----------
srcs = [rasterio.open(f) for f in sorted(glob.glob('dem_*.tif'))]
dem, tr = merge(srcs, bounds=(W - .02, S - .02, E + .02, N + .02)); dem = dem[0].astype('float32')
px_lat = abs(tr.e) * KY; px_lon = tr.a * KX
dem = gaussian_filter(dem, sigma=(60 / px_lat, 60 / px_lon))
def elev(lat, lon):
    r = (lat - tr.f) / tr.e; c = (lon - tr.c) / tr.a
    return map_coordinates(dem, [np.asarray(r), np.asarray(c)], order=1)

# ---------- OSM ways ----------
raw = json.load(open('ways.json'))['elements']
loc = {e['id']: (e['lat'], e['lon']) for e in raw if e['type'] == 'node'}
ways = [e for e in raw if e['type'] == 'way']
print('ways', len(ways), 'nodes', len(loc))
use = []; deg = {}
names = {}
for w in ways:
    t = w.get('tags', {}); hw = t.get('highway'); foot = t.get('foot')
    if hw in NO_WALK or hw is None: continue
    if foot == 'no': continue
    if t.get('access') in ('no', 'private') and foot not in ('yes', 'designated', 'permissive'): continue
    if t.get('area') == 'yes' and hw not in ('pedestrian', 'footway'): continue
    nd = [n for n in w['nodes'] if n in loc]
    if len(nd) < 2: continue
    flat = t.get('bridge', 'no') != 'no' or t.get('tunnel', 'no') != 'no'
    oneway_foot = False  # walking ignores car one-way
    use.append((nd, flat))
    for i, n in enumerate(nd):
        deg[n] = deg.get(n, 0) + (1 if i in (0, len(nd) - 1) else 2)
    nm = t.get('name:ru') or t.get('name')
    if nm and hw in ('primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian', 'trunk', 'service') and hw != 'service':
        mid = loc[nd[len(nd) // 2]]
        names.setdefault(nm, []).append(mid)
print('walkable ways', len(use))

# elevation per node used
ids = sorted({n for nd, _ in use for n in nd})
idx = {n: i for i, n in enumerate(ids)}
la = np.array([loc[n][0] for n in ids]); lo = np.array([loc[n][1] for n in ids])
z = elev(la, lo)

# keep nodes: endpoints / intersections (deg != 2) ; contract chains of degree-2 nodes
keep = set(n for n in ids if deg.get(n, 0) != 2)
for nd, _ in use:
    keep.add(nd[0]); keep.add(nd[-1])

def seg_times(a, b, za, zb):
    dx = (lo[b] - lo[a]) * KX; dy = (la[b] - la[a]) * KY
    L = math.hypot(dx, dy)
    if L < 0.01: return 0.0, 0.0, 0.0
    s = (zb - za) / L; s = max(-0.5, min(0.5, s))
    return L, L / (V0 * tobler_rel(s)), L / (V0 * tobler_rel(-s))

edges = {}  # (u,v) -> [L, tuv, tvu, mid geometry list]
for nd, flat in use:
    ii = [idx[n] for n in nd]
    if flat:
        za, zb = z[ii[0]], z[ii[-1]]
        tot = sum(math.hypot((lo[b] - lo[a]) * KX, (la[b] - la[a]) * KY) for a, b in zip(ii, ii[1:])) or 1
        acc = 0; zz = [za]
        for a, b in zip(ii, ii[1:]):
            acc += math.hypot((lo[b] - lo[a]) * KX, (la[b] - la[a]) * KY); zz.append(za + (zb - za) * acc / tot)
    else:
        zz = [z[i] for i in ii]
    start = 0; L = tf = tb = 0.0; geom = []
    for k in range(1, len(ii)):
        l, a, b = seg_times(ii[k - 1], ii[k], zz[k - 1], zz[k]); L += l; tf += a; tb += b
        if nd[k] in keep:
            u, v = nd[start], nd[k]
            if u != v:
                key = (u, v) if u < v else (v, u)
                ff, bb = (tf, tb) if u < v else (tb, tf)
                g = geom if u < v else geom[::-1]
                if key not in edges or edges[key][0] > L:
                    edges[key] = [L, ff, bb, g]
            start = k; L = tf = tb = 0.0; geom = []
        else:
            geom.append(ii[k])
print('edges', len(edges))

# keep only the largest connected component
import collections
adj = collections.defaultdict(list)
for (u, v) in edges: adj[u].append(v); adj[v].append(u)
seen = {}; best = None
for s0 in adj:
    if s0 in seen: continue
    comp = [s0]; seen[s0] = len(comp); q = [s0]
    while q:
        x = q.pop()
        for y in adj[x]:
            if y not in seen: seen[y] = 1; comp.append(y); q.append(y)
    if best is None or len(comp) > len(best): best = comp
bestset = set(best)
edges = {k: v for k, v in edges.items() if k[0] in bestset}
print('largest component nodes', len(bestset), 'edges', len(edges))

# simplify interior geometry (Douglas-Peucker, 5 m) and add simplified points as geometry only
def dp(pts, eps=5.0):
    if len(pts) < 3: return [0, len(pts) - 1]
    P = np.array([[lo[i] * KX, la[i] * KY] for i in pts]); a, b = P[0], P[-1]
    ab = b - a; n = np.hypot(*ab)
    Q = P - a; d = np.abs(ab[0] * Q[:, 1] - ab[1] * Q[:, 0]) / n if n > 0 else np.hypot(Q[:, 0], Q[:, 1])
    k = int(np.argmax(d))
    if d[k] <= eps: return [0, len(pts) - 1]
    l = dp(pts[:k + 1], eps); r = dp(pts[k:], eps)
    return l[:-1] + [x + k for x in r]

graph_nodes = sorted(bestset); gi = {n: i for i, n in enumerate(graph_nodes)}
geo_pts = []  # flat list of (lat,lon) for edge interiors
E_from, E_to, E_tf, E_tb, E_len, E_g0, E_gn = [], [], [], [], [], [], []
for (u, v), (L, tf, tb, g) in edges.items():
    chain = [idx[u]] + g + [idx[v]]
    keepk = dp(chain)
    inner = [chain[k] for k in keepk[1:-1]]
    E_from.append(gi[u]); E_to.append(gi[v]); E_tf.append(tf); E_tb.append(tb); E_len.append(L)
    E_g0.append(len(geo_pts)); E_gn.append(len(inner))
    geo_pts.extend(inner)
nN, nE, nG = len(graph_nodes), len(E_from), len(geo_pts)
print('N', nN, 'E', nE, 'G', nG)
glat = np.array([la[idx[n]] for n in graph_nodes]); glon = np.array([lo[idx[n]] for n in graph_nodes])
gz = np.array([z[idx[n]] for n in graph_nodes])

import os; os.makedirs(OUT, exist_ok=True)
with open(f'{OUT}/graph.bin', 'wb') as f:
    f.write(struct.pack('<4I', nN, nE, nG, 1))
    f.write(np.round((glat - S) * 1e6).astype('<i4').tobytes())
    f.write(np.round((glon - W) * 1e6).astype('<i4').tobytes())
    f.write(np.round(gz).astype('<i2').tobytes())
    if nN % 2: f.write(b'\0\0')
    f.write(np.array(E_from, '<u4').tobytes()); f.write(np.array(E_to, '<u4').tobytes())
    f.write(np.minimum(np.round(np.array(E_tf) * 10), 65535).astype('<u2').tobytes())
    f.write(np.minimum(np.round(np.array(E_tb) * 10), 65535).astype('<u2').tobytes())
    f.write(np.minimum(np.round(np.array(E_len)), 65535).astype('<u2').tobytes())
    if nE % 2: f.write(b'\0\0')
    f.write(np.array(E_g0, '<u4').tobytes()); f.write(np.array(E_gn, '<u2').tobytes())
    if nE % 2: f.write(b'\0\0')
    f.write(np.round((np.array([la[i] for i in geo_pts]) - S) * 1e6).astype('<i4').tobytes())
    f.write(np.round((np.array([lo[i] for i in geo_pts]) - W) * 1e6).astype('<i4').tobytes())
print('graph.bin', os.path.getsize(f'{OUT}/graph.bin'))

tree = cKDTree(np.c_[glon * KX, glat * KY])

# ---------- places ----------
pl = json.load(open('places.json'))['elements']
def ring_area(pts):
    if len(pts) < 3: return 0.0
    xs = np.array([p[1] for p in pts]) * KX; ys = np.array([p[0] for p in pts]) * KY
    return 0.5 * abs(np.dot(xs, np.roll(ys, 1)) - np.dot(ys, np.roll(xs, 1)))
places = []
for e in pl:
    t = e.get('tags', {}); kind = 'library' if t.get('amenity') == 'library' else 'park'
    name = t.get('name:ru') or t.get('name') or t.get('name:kk')
    if e['type'] == 'node': rings = [[(e['lat'], e['lon'])]]
    elif e['type'] == 'way': rings = [[(g['lat'], g['lon']) for g in e.get('geometry', [])]]
    else: rings = [[(g['lat'], g['lon']) for g in m.get('geometry', [])] for m in e.get('members', []) if m.get('role') in ('outer', '') and m.get('geometry')]
    pts = [p for r in rings for p in r]
    if not pts: continue
    area = sum(ring_area(r) for r in rings)
    if kind == 'park':
        if area < 3000: continue  # tiny squares under 0.3 ha
        if not name and area < 20000: continue
    cy = float(np.mean([p[0] for p in pts])); cx = float(np.mean([p[1] for p in pts]))
    if not (S < cy < N and W < cx < E): continue
    # access points: polygon vertices (every ~40 m) snapped to network within 60 m
    cand = pts if len(pts) < 400 else pts[::len(pts) // 400 + 1]
    q = np.c_[np.array([p[1] for p in cand]) * KX, np.array([p[0] for p in cand]) * KY]
    d, j = tree.query(q, distance_upper_bound=60 if kind == 'park' else 120)
    acc = sorted({int(x) for x, dd in zip(j, d) if np.isfinite(dd)})
    if not acc:
        d, j = tree.query([cx * KX, cy * KY])
        if d > 200: continue
        acc = [int(j)]
    if len(acc) > 40: acc = acc[::len(acc) // 40 + 1]
    places.append(dict(k=kind, n=name or '', a=round(area / 10000, 2), y=round(cy, 6), x=round(cx, 6), acc=acc,
                       ring=[[round(p[0], 5), round(p[1], 5)] for p in (rings[0] if len(rings[0]) < 300 else rings[0][::len(rings[0]) // 300 + 1])] if kind == 'park' and e['type'] != 'node' else None,
                       osm=f"{e['type']}/{e['id']}"))
# drop duplicates: same kind + same name within 500 m (OSM often maps one place as a point and an outline)
places.sort(key=lambda p: -p['a']); kept = []
for p in places:
    if any(q['k'] == p['k'] and q['n'] == p['n'] and math.hypot((q['x'] - p['x']) * KX, (q['y'] - p['y']) * KY) < 500 for q in kept):
        continue
    kept.append(p)
places = kept
print('places', collections.Counter(p['k'] for p in places))

# ---------- districts ----------
dj = json.load(open('districts.json'))['elements']
districts = []
for r in dj:
    t = r.get('tags', {}); nm = t.get('name:ru') or t.get('name')
    segs = [[(g['lat'], g['lon']) for g in m['geometry']] for m in r.get('members', []) if m.get('type') == 'way' and m.get('role') == 'outer' and m.get('geometry')]
    # stitch segments into rings
    rings = []; segs = [s for s in segs if len(s) > 1]
    while segs:
        ring = segs.pop(0)
        changed = True
        while changed and ring[0] != ring[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]: ring += s[1:]; segs.pop(i); changed = True; break
                if s[-1] == ring[-1]: ring += s[::-1][1:]; segs.pop(i); changed = True; break
        rings.append(ring)
    rings.sort(key=lambda r: -ring_area(r))
    lats = [p[0] for p in rings[0]]; lons = [p[1] for p in rings[0]]
    districts.append(dict(n=nm, b=[min(lats), min(lons), max(lats), max(lons)],
                          ring=[[round(p[0], 5), round(p[1], 5)] for p in rings[0][::max(1, len(rings[0]) // 400)]]))
print('districts', [d['n'] for d in districts])

# ---------- street names (local search, nothing leaves the browser) ----------
def inring(p, r):
    ins = False; j = len(r) - 1
    for i in range(len(r)):
        (yi, xi), (yj, xj) = r[i], r[j]
        if (yi > p[0]) != (yj > p[0]) and p[1] < (xj - xi) * (p[0] - yi) / (yj - yi) + xi: ins = not ins
        j = i
    return ins
def dist_of(p):
    for d in districts:
        if inring(p, d['ring']): return d['n'].replace(' район', '')
    return None
groups = {}
for nm, mids in names.items():
    key = ' '.join(nm.lower().replace('ё', 'е').split())
    g = groups.setdefault(key, [nm, []]); g[1].extend(mids)
    if nm[:1].isupper() and not g[0][:1].isupper(): g[0] = nm
streets = []
for key, (nm, mids) in groups.items():
    mids = [m for m in mids if S < m[0] < N and W < m[1] < E]
    clusters = []  # single-linkage, 900 m
    for m in mids:
        hit = [c for c in clusters if any(math.hypot((m[1] - q[1]) * KX, (m[0] - q[0]) * KY) < 900 for q in c)]
        merged = [m] + [q for c in hit for q in c]
        clusters = [c for c in clusters if c not in hit] + [merged]
    rows = []
    for c in clusters:
        cy = sum(q[0] for q in c) / len(c); cx = sum(q[1] for q in c) / len(c)
        mid = min(c, key=lambda q: (q[0] - cy) ** 2 + (q[1] - cx) ** 2)
        dn = dist_of(mid)
        if dn: rows.append([dn, mid, c])  # only streets inside the city's eight districts
    for dn, mid, c in rows:
        label = f'{nm} ({dn})' if len(rows) > 1 else nm
        streets.append([label, round(mid[0], 5), round(mid[1], 5), round(min(q[0] for q in c), 5), round(min(q[1] for q in c), 5),
                        round(max(q[0] for q in c), 5), round(max(q[1] for q in c), 5)])
seen = {}
for s_ in streets:
    if s_[0] in seen: seen[s_[0]] += 1; s_[0] = (s_[0][:-1] + f', {seen[s_[0]]})') if s_[0].endswith(')') else f'{s_[0]}, {seen[s_[0]]}'
    else: seen[s_[0]] = 1
streets.sort()
json.dump(dict(places=places, districts=districts, streets=streets,
               meta=dict(bbox=[S, W, N, E], built='2026-11-23', v0_kmh=4.8, dem='Copernicus DEM GLO-30, smoothed 60 m',
                         osm='OpenStreetMap, Geofabrik Kazakhstan extract 2026-11-22T21:20:48Z')),
          open(f'{OUT}/city.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('city.json', os.path.getsize(f'{OUT}/city.json'), 'streets', len(streets))
