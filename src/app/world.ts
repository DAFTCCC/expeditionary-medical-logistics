import { geoArea, geoCentroid } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import topo from 'world-atlas/countries-50m.json';

/**
 * Bundled world map (Natural Earth 1:50m via world-atlas) — works offline.
 * Countries are keyed by their map name (e.g. "Germany", "United States of America").
 */

type Country = Feature<Geometry, { name: string }>;

const t = topo as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
export const countries = feature(t, t.objects.countries) as FeatureCollection<Geometry, { name: string }>;

export const COUNTRY_NAMES: string[] = countries.features.map((f) => f.properties.name).sort((a, b) => a.localeCompare(b));

const byName = new Map<string, Country>(countries.features.map((f) => [f.properties.name, f]));

export function countryFeature(name: string): Country | undefined {
  return byName.get(name);
}

const centroids = new Map<string, [number, number]>();
/** Centre of the country's largest landmass (so a pin sits on the main territory, not mid-ocean). */
export function countryCentroid(name: string): [number, number] | undefined {
  const hit = centroids.get(name);
  if (hit) return hit;
  const f = byName.get(name);
  if (!f) return undefined;
  let geom: Geometry = f.geometry;
  if (geom.type === 'MultiPolygon') {
    const polys = (geom as MultiPolygon).coordinates.map((c): Polygon => ({ type: 'Polygon', coordinates: c }));
    geom = polys.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
  }
  const c = geoCentroid({ type: 'Feature', geometry: geom, properties: {} }) as [number, number];
  centroids.set(name, c);
  return c;
}
