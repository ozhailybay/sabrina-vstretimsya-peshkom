"""Read the Geofabrik Kazakhstan extract and write the three Overpass-style JSON files build.py reads
(ways.json, places.json, districts.json) for the Almaty box. Same selection as Sabrina's CASJ paper."""
import osmium, json, sys
S, W, N, E = 43.15, 76.68, 43.40, 77.10
DISTRICTS = {3072001, 3072130, 3072216, 3072217, 3072807, 3072808, 3390291, 5460063}
inb = lambda y, x: S < y < N and W < x < E
ways, nodes, places, dist = [], {}, [], []

class H(osmium.SimpleHandler):
    def node(self, n):
        if n.tags.get('amenity') == 'library' and n.location.valid() and inb(n.location.lat, n.location.lon):
            places.append(dict(type='node', id=n.id, lat=n.location.lat, lon=n.location.lon, tags=dict(n.tags)))
    def way(self, w):
        t = w.tags
        pts = [(nd.ref, nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        if not pts or not any(inb(p[1], p[2]) for p in pts): return
        if t.get('highway'):
            for p in pts: nodes[p[0]] = (p[1], p[2])
            ways.append(dict(type='way', id=w.id, nodes=[p[0] for p in pts], tags={k: t.get(k) for k in
                        ('highway', 'foot', 'access', 'area', 'bridge', 'tunnel', 'name', 'name:ru') if k in t}))
        if t.get('leisure') == 'park' or t.get('amenity') == 'library':
            places.append(dict(type='way', id=w.id, tags=dict(t), geometry=[dict(lat=p[1], lon=p[2]) for p in pts]))
    def area(self, a):
        t = a.tags
        if a.from_way(): return
        rid = a.orig_id()
        outer = [[dict(lat=n.lat, lon=n.lon) for n in r] for r in a.outer_rings()]
        if rid in DISTRICTS:
            dist.append(dict(type='relation', id=rid, tags=dict(t),
                             members=[dict(type='way', role='outer', geometry=r) for r in outer]))
        elif t.get('leisure') == 'park' or t.get('amenity') == 'library':
            if any(inb(p['lat'], p['lon']) for r in outer for p in r):
                places.append(dict(type='relation', id=rid, tags=dict(t),
                                   members=[dict(type='way', role='outer', geometry=r) for r in outer]))

H().apply_file(sys.argv[1], locations=True, idx='flex_mem')
json.dump(dict(elements=ways + [dict(type='node', id=k, lat=v[0], lon=v[1]) for k, v in nodes.items()]), open('ways.json', 'w'))
json.dump(dict(elements=places), open('places.json', 'w'), ensure_ascii=False)
json.dump(dict(elements=dist), open('districts.json', 'w'), ensure_ascii=False)
print('ways', len(ways), 'nodes', len(nodes), 'places', len(places), 'districts', len(dist))
