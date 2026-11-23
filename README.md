# Встретимся пешком / Meet on Foot

Two people in Almaty mark where they live. The site finds a park or a library that both of them can reach on foot in 15 minutes and shows each walk, there and back home.

Idea and research: **Sabrina Torekhan** (Almaty). Code assembled by her ADMIT mentor with the help of AI (Claude by Anthropic). Built for CSC Winter Sparkathon 2026.

Based on Sabrina's earlier site [15 Minutes Almaty](https://15-minut-almaty.netlify.app), which used a 1.2 km circle for one person. This version adds two people, real street routes, slope-aware walking speed and a fair ranking.

## How it works

- Every street segment of Almaty from OpenStreetMap gets its slope from the Copernicus GLO-30 terrain model (smoothed over 60 m).
- Walking speed follows Tobler's hiking function, `v = 6 · e^(−3.5·|s+0.05|)` km/h, scaled so a flat street is 4.8 km/h (15 min = 1.2 km). Each segment has a time for each direction, so the walk home can differ from the walk there.
- In the browser, Dijkstra runs from each person (forward for "there", on the reversed graph for "home") up to 30 minutes.
- Places are ranked by the longer of the two walks, then by their sum.

## Privacy

Everything runs in the browser. Points are not saved or sent anywhere. Street search uses a list built into the page. The only outside requests are map tiles.

## Files

- `site/`: the static site (Главная, the tool, О проекте). Deploy this folder as is.
- `site/data/graph.bin`: the walking graph (nodes, heights, two travel times per edge, geometry).
- `site/data/city.json`: parks, libraries, districts and the street list.
- `data-build/`: scripts that build those two files.

## Rebuilding the data

```bash
cd data-build
curl -LO https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf
curl -L -o dem_N43_E076.tif https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N43_00_E076_00_DEM/Copernicus_DSM_COG_10_N43_00_E076_00_DEM.tif
curl -L -o dem_N43_E077.tif https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N43_00_E077_00_DEM/Copernicus_DSM_COG_10_N43_00_E077_00_DEM.tif
pip install osmium rasterio scipy numpy
python extract.py   # writes ways.json, places.json, districts.json
python build.py     # writes ../site/data/graph.bin and city.json
```

## Credits

- Map data © OpenStreetMap contributors, ODbL. Extract from Geofabrik, 22 Nov 2026.
- Copernicus DEM GLO-30: © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA.
- Leaflet; map tiles © OpenStreetMap.
- W. Tobler (1993), Three presentations on geographical analysis and modeling.

Code: MIT licence.
