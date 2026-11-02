import { useMemo, useState } from 'react';
import { geoEqualEarth, geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { mapData, type CountryPin } from '../model';
import { useStore } from '../store';
import { Empty, href, Section, useSession } from '../ui';
import { countries, countryCentroid } from '../world';

/**
 * Country-level map (ADR-009). Pins sit at the centre of a country, never at a
 * site: no coordinates are stored or shown.
 */

const narrowScreen = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px)').matches;
const SHORT: Record<string, string> = { 'United States of America': 'United States', 'Dem. Rep. Congo': 'DR Congo', 'Central African Rep.': 'CAR', 'Bosnia and Herz.': 'Bosnia & Herz.', 'Dominican Rep.': 'Dominican Rep.' };
const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;

/** Push overlapping pins apart (screen space) so neighbouring countries stay tappable. */
function spread(points: { key: string; x: number; y: number; r: number }[]): Map<string, [number, number]> {
  const pts = points.map((p) => ({ ...p }));
  for (let iter = 0; iter < 40; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + b.r + 6;
      if (d < min) {
        const push = (min - d) / 2, ux = d > 0.02 ? dx / d : 1, uy = d > 0.02 ? dy / d : 0;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; moved = true;
      }
    }
    if (!moved) break;
  }
  return new Map(pts.map((p) => [p.key, [p.x, p.y]]));
}

function tone(c: CountryPin): 'bad' | 'warn' | 'ok' {
  if (c.missing > 0 || c.expiredOnShelf > 0) return 'bad';
  if (c.equipmentAttention > 0 || c.quarantine > 0) return 'warn';
  return 'ok';
}

export function MapPage() {
  const { p, L } = useStore();
  const { scope } = useSession();
  const [sel, setSel] = useState<string | null>(null);
  const [fit, setFit] = useState<'world' | 'pins'>('pins');
  const data = mapData(p, L, scope);
  const [W, H] = narrowScreen() ? [600, 400] : [960, 480];

  const projection = useMemo(() => {
    const pad = 44;
    const pts = data.pins.map((x) => countryCentroid(x.country)).filter((c): c is [number, number] => !!c);
    // Centre the world on the pins' average longitude (circular mean), so pins are not split across the edges.
    const lon = pts.length ? (Math.atan2(pts.reduce((a, c) => a + Math.sin((c[0] * Math.PI) / 180), 0), pts.reduce((a, c) => a + Math.cos((c[0] * Math.PI) / 180), 0)) * 180) / Math.PI : 0;
    const world = geoEqualEarth().rotate([-lon, 0]).fitExtent([[8, 8], [W - 8, H - 8]], { type: 'Sphere' } as never);
    if (fit === 'world' || pts.length === 0) return world;
    // Fit to the pins' centre points (not country outlines: e.g. the US outline spans the date line).
    const target = { type: 'MultiPoint', coordinates: pts };
    const proj = geoEqualEarth().rotate([-lon, 0]).fitExtent([[pad + 60, pad + 10], [W - pad - 60, H - pad - 20]], target as never);
    if (proj.scale() <= world.scale() * 1.15) return world; // pins span the globe: whole world fills the frame best
    if (proj.scale() > world.scale() * 5) {
      // Single country or tight cluster: keep some regional context.
      const [cx, cy] = proj.invert!([W / 2, H / 2]) ?? [0, 0];
      proj.scale(world.scale() * 5).translate([W / 2, H / 2]);
      const at = proj([cx, cy]);
      if (at) proj.translate([W - at[0], H - at[1]]);
    }
    // Never show empty space beyond the edge of the world map.
    const [[x0, y0], [x1, y1]] = geoPath(proj).bounds({ type: 'Sphere' } as never);
    const [tx, ty] = proj.translate();
    const dx = x0 > 0 ? -x0 : x1 < W ? W - x1 : 0;
    const dy = y0 > 0 ? -y0 : y1 < H ? H - y1 : 0;
    proj.translate([tx + dx, ty + dy]);
    return proj;
  }, [fit, W, data.pins.map((x) => x.country).join('|')]);
  const path = geoPath(projection);
  const sphere = path({ type: 'Sphere' } as never) ?? '';

  const maxUnits = Math.max(1, ...data.pins.map((x) => x.usable + x.custody + x.inbound));
  const radius = (c: CountryPin) => 9 + 13 * Math.sqrt((c.usable + c.custody + c.inbound) / maxUnits);
  const selected = data.pins.find((x) => x.country === sel);
  const placed = spread(data.pins.flatMap((c) => {
    const ll = countryCentroid(c.country);
    const xy = ll && projection(ll);
    return xy ? [{ key: c.country, x: xy[0], y: xy[1], r: radius(c) + (c.isHubCountry ? 5 : 0) }] : [];
  }));
  const pinned = new Set(data.pins.map((x) => x.country));

  return (
    <>
      <div className="page-head">
        <h1>Map</h1>
        <span className="sub">{L.scopeName(scope)} · pins show the country only, never the exact site · works offline</span>
      </div>
      {data.unplaced.length > 0 && (
        <div className="banner info">
          <strong>{data.unplaced.length} location{data.unplaced.length === 1 ? '' : 's'} not on the map</strong>
          <span>Set a country on the hub or site in <a href={href('setup', { tab: 'locations' })}>Setup → Locations</a> (storage areas and kits inherit it): {data.unplaced.slice(0, 4).map((l) => l.name).join(', ')}{data.unplaced.length > 4 ? '…' : ''}</span>
        </div>
      )}
      <section className="card map-card">
        <div className="map-tools">
          <div className="seg" role="group" aria-label="Map view">
            <button className={fit === 'pins' ? 'on' : ''} onClick={() => setFit('pins')}>Zoom to pins</button>
            <button className={fit === 'world' ? 'on' : ''} onClick={() => setFit('world')}>Whole world</button>
          </div>
          <div className="legend">
            <span><i className="dot ok" /> OK</span>
            <span><i className="dot warn" /> Equipment or quarantine to check</span>
            <span><i className="dot bad" /> Missing or expired stock</span>
            <span><i className="ring" /> Hub country</span>
            <span><i className="dash" /> In transit</span>
          </div>
        </div>
        <svg className="worldmap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="World map with country pins">
          <defs>
            <clipPath id="sphere"><path d={sphere} /></clipPath>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="arrowhead" /></marker>
          </defs>
          <path d={sphere} className="ocean" />
          <g clipPath="url(#sphere)">
            {countries.features.map((f) => (
              <path key={f.properties.name} d={path(f) ?? ''} className={pinned.has(f.properties.name) ? 'land active' : 'land'} onClick={() => pinned.has(f.properties.name) && setSel(f.properties.name)}>
                <title>{f.properties.name}</title>
              </path>
            ))}
            {data.links.map((l) => {
              const a = countryCentroid(l.from), b = countryCentroid(l.to);
              if (!a || !b) return null;
              const line: LineString = { type: 'LineString', coordinates: [a, b] };
              return <path key={l.from + l.to} d={path(line) ?? ''} className="link" markerEnd="url(#arrow)"><title>{`${l.qty} units in transit ${l.from} → ${l.to} (${l.shipments} shipment${l.shipments === 1 ? '' : 's'})`}</title></path>;
            })}
          </g>
          {data.pins.map((c) => {
            const xy = placed.get(c.country);
            if (!xy) return null;
            const r = radius(c);
            return (
              <g key={c.country} className={`pin ${tone(c)} ${sel === c.country ? 'sel' : ''}`} transform={`translate(${xy[0]},${xy[1]})`} onClick={() => setSel(c.country)} tabIndex={0} role="button" aria-label={`${c.country}: ${c.usable} usable units`} onKeyDown={(e) => e.key === 'Enter' && setSel(c.country)}>
                {c.isHubCountry && <circle r={r + 5} className="hubring" />}
                <circle r={r} />
                <text dy="0.35em">{c.usable + c.custody}</text>
                <text className="pin-label" y={r + 14} x={xy[0] < 90 ? -r : xy[0] > W - 90 ? r : 0} style={{ textAnchor: xy[0] < 90 ? 'start' : xy[0] > W - 90 ? 'end' : 'middle' }}>{SHORT[c.country] ?? c.country}</text>
              </g>
            );
          })}
        </svg>
        {data.pins.length === 0 && <Empty>No locations have a country yet.</Empty>}
      </section>

      {selected && <CountryPanel c={selected} onClose={() => setSel(null)} />}

      <Section title="By country">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Country</th><th className="num">Usable</th><th className="num">In custody</th><th className="num">Inbound</th><th className="num">Equipment</th><th>Flags</th></tr></thead>
            <tbody>
              {data.pins.map((c) => (
                <tr key={c.country} className={sel === c.country ? 'row-sel' : ''}>
                  <td><button className="link" onClick={() => setSel(c.country)}>{c.country}</button>{c.isHubCountry ? <span className="sub"> · hub</span> : ''}</td>
                  <td className="num">{c.usable}</td><td className="num">{c.custody}</td><td className="num">{c.inbound || ''}</td>
                  <td className="num">{c.equipment}{c.equipmentAttention ? ` (${c.equipmentAttention} to check)` : ''}</td>
                  <td>
                    {c.missing > 0 && <span className="badge bad">{c.missing} missing</span>}{' '}
                    {c.expiredOnShelf > 0 && <span className="badge bad">{c.expiredOnShelf} expired</span>}{' '}
                    {c.quarantine > 0 && <span className="badge warn">{c.quarantine} quarantined</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function CountryPanel({ c, onClose }: { c: CountryPin; onClose: () => void }) {
  const { L } = useStore();
  return (
    <Section title={c.country} actions={<button className="btn small secondary" onClick={onClose}>Close</button>}>
      <dl className="kv">
        <dt>Supported by</dt><dd>{c.hubs.map((h) => L.locationName(h)).join(', ') || '—'}</dd>
        <dt>Usable stock</dt><dd>{units(c.usable)}</dd>
        <dt>In personal custody</dt><dd>{units(c.custody)} (people based here)</dd>
        {c.inbound > 0 && <><dt>Inbound</dt><dd>{units(c.inbound)} in transit</dd></>}
        {c.quarantine > 0 && <><dt>Quarantine</dt><dd>{units(c.quarantine)}</dd></>}
        {c.missing > 0 && <><dt>Missing</dt><dd><span className="badge bad">{units(c.missing)}</span></dd></>}
        {c.expiredOnShelf > 0 && <><dt>Expired on shelf</dt><dd><span className="badge bad">{units(c.expiredOnShelf)}</span></dd></>}
        <dt>Equipment</dt><dd>{c.equipment}{c.equipmentAttention ? ` — ${c.equipmentAttention} need checking` : ''}</dd>
      </dl>
      <ul className="list">
        {c.locations.map((l) => (
          <li key={l.id}>
            <strong>{l.name}</strong> <span className="sub">{l.kind.replace('_', ' ').toLowerCase()}</span>{' '}
            <a className="btn small" href={href('act/issue', { from: l.id })}>Issue from</a>{' '}
            <a className="btn small secondary" href={href('equipment', { at: l.id })}>Equipment</a>
          </li>
        ))}
      </ul>
    </Section>
  );
}
