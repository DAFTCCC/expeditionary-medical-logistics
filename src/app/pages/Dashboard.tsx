import { dashboard, formatTime, inventory, unitLabel, type Dashboard } from '../model';
import { useStore } from '../store';
import { Empty, ExpiryBadge, href, Section, useSession } from '../ui';

function Tile({ label, value, tone, to }: { label: string; value: number | string; tone?: 'bad' | 'warn' | 'ok'; to?: string }) {
  const body = (
    <>
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
    </>
  );
  return to ? <a className={`tile ${tone ?? ''}`} href={to}>{body}</a> : <div className={`tile ${tone ?? ''}`}>{body}</div>;
}

export function DashboardPage() {
  const { p, L } = useStore();
  const { scope } = useSession();
  const now = new Date();
  const d = dashboard(p, L, scope, now);
  const lotName = (lotId: string) => {
    const lot = p.lots.get(lotId);
    return lot ? `${L.items.get(lot.itemId)?.name} · lot ${lot.lotNumber}` : lotId;
  };

  return (
    <>
      <div className="page-head">
        <h1>{L.scopeName(scope)}</h1>
        <div className="clocks">
          {L.hubs().filter((h) => scope === 'ALL' || h.id === scope).map((h) => (
            <span key={h.id}>{h.name}: <strong>{formatTime(now.toISOString(), h.timeZone)}</strong></span>
          ))}
        </div>
      </div>

      <div className="tiles">
        <Tile label="Usable units available" value={d.unitsAvailable} to={href('inventory')} />
        <Tile label="Units in personal custody" value={d.unitsInCustody} to={href('inventory', { bucket: 'CUSTODY' })} />
        <Tile label="Items below reorder point" value={d.itemsBelowReorder.length} tone={d.itemsBelowReorder.length ? 'warn' : 'ok'} to={href('inventory', { low: '1' })} />
        <Tile label="Expired lots still holding stock" value={d.lotsExpiredWithStock.length} tone={d.lotsExpiredWithStock.length ? 'bad' : 'ok'} to={href('inventory', { exp: 'EXPIRED' })} />
        <Tile label="Lots expiring ≤ 90 days" value={d.lotsExpiringSoon.length} tone={d.lotsExpiringSoon.length ? 'warn' : 'ok'} to={href('inventory', { exp: 'SOON' })} />
        <Tile label="Returns awaiting acceptance" value={d.pendingReturns.length} tone={d.pendingReturns.length ? 'warn' : 'ok'} to={href('act/accept')} />
        <Tile label="Shipments in transit" value={d.shipmentsInTransit.length} to={href('act/transfer-receive')} />
        <Tile label="Units missing" value={d.missing.reduce((n, r) => n + r.qty, 0)} tone={d.missing.length ? 'bad' : 'ok'} />
        <Tile label="Equipment not confirmed in 30 days" value={`${d.equipmentOverdueConfirm} / ${d.equipmentTotal}`} tone={d.equipmentOverdueConfirm ? 'warn' : 'ok'} to={href('equipment')} />
        <Tile label="Equipment not fully operational" value={d.equipmentNotOperational} tone={d.equipmentNotOperational ? 'bad' : 'ok'} to={href('equipment')} />
      </div>

      {scope === 'ALL' && <HubComparison />}

      <div className="grid2">
        <Section title="Needs attention">
          <ul className="list">
            {d.lotsExpiredWithStock.map((l) => (
              <li key={l.lot.id}><a href={href(`lot/${l.lot.id}`)}>{l.item.name} · lot {l.lot.lotNumber}</a> <ExpiryBadge lot={l.lot} /> <span className="sub">{l.onHand} {unitLabel(l.item.unit, l.onHand)} on hand — quarantine and dispose</span></li>
            ))}
            {d.itemsBelowReorder.map((i) => (
              <li key={i.item.id}><strong>{i.item.name}</strong> <span className="badge warn">Low</span> <span className="sub">{scope === 'ALL' ? `low at ${i.lowAt.map((h) => L.locationName(h)).join(' and ')}` : `${i.available} usable ${unitLabel(i.item.unit, i.available)}`}; reorder point {i.item.reorderPoint} per hub</span></li>
            ))}
            {d.missing.map((r) => (
              <li key={`${r.lotId}${r.holderId}`}><a href={href(`lot/${r.lotId}`)}>{lotName(r.lotId)}</a> <span className="badge bad">Missing {r.qty}</span> <span className="sub">at {L.holderName(r)}</span></li>
            ))}
            {!d.lotsExpiredWithStock.length && !d.itemsBelowReorder.length && !d.missing.length && <Empty>Nothing needs attention.</Empty>}
          </ul>
        </Section>

        <Section title="Open hand-offs">
          <ul className="list">
            {d.pendingReturns.map((r) => (
              <li key={r.eventId}>
                <strong>Return</strong> {r.remaining} × {lotName(r.lotId)} <span className="sub">from {L.personName(r.personId)} at {L.locationName(r.locationId)}</span>{' '}
                <a className="btn small" href={href('act/accept', { return: r.eventId })}>Inspect &amp; accept</a>
              </li>
            ))}
            {d.shipmentsInTransit.map((s) => (
              <li key={s.eventId}>
                <strong>Shipment</strong> {s.remaining} × {lotName(s.lotId)} <span className="sub">{L.locationName(s.fromLocationId)} → {L.locationName(s.toLocationId)}</span>{' '}
                <a className="btn small" href={href('act/transfer-receive', { ship: s.eventId })}>Receive</a>
              </li>
            ))}
            {!d.pendingReturns.length && !d.shipmentsInTransit.length && <Empty>No open returns or shipments.</Empty>}
          </ul>
        </Section>

        <Section title="Expiring within 90 days">
          <ul className="list">
            {d.lotsExpiringSoon.map((l) => (
              <li key={l.lot.id}><a href={href(`lot/${l.lot.id}`)}>{l.item.name} · lot {l.lot.lotNumber}</a> <ExpiryBadge lot={l.lot} /> <span className="sub">{l.onHand} on hand — use first (FEFO)</span></li>
            ))}
            {!d.lotsExpiringSoon.length && <Empty>No lots expiring soon.</Empty>}
          </ul>
        </Section>
      </div>
    </>
  );
}

function HubComparison() {
  const { p, L } = useStore();
  const now = new Date();
  const hubs = L.hubs();
  const stats: [string, (d: Dashboard, avail: number) => string | number][] = [
    ['Usable units available', (_d, a) => a],
    ['Units in custody', (d) => d.unitsInCustody],
    ['Items below reorder', (d) => d.itemsBelowReorder.length],
    ['Lots expiring ≤ 90 d', (d) => d.lotsExpiringSoon.length],
    ['Expired lots with stock', (d) => d.lotsExpiredWithStock.length],
    ['Pending returns', (d) => d.pendingReturns.length],
    ['Units missing', (d) => d.missing.reduce((n, r) => n + r.qty, 0)],
    ['Equipment overdue confirmation', (d) => d.equipmentOverdueConfirm],
  ];
  const data = hubs.map((h) => {
    const d = dashboard(p, L, h.id, now);
    const avail = inventory(p, L, h.id, now).reduce((n, i) => n + i.available, 0);
    return { h, d, avail };
  });
  return (
    <Section title="Hubs side by side">
      <div className="table-wrap">
        <table>
          <thead><tr><th></th>{data.map(({ h }) => <th key={h.id}>{h.name}</th>)}</tr></thead>
          <tbody>
            {stats.map(([label, f]) => (
              <tr key={label}><th scope="row">{label}</th>{data.map(({ h, d, avail }) => <td key={h.id} className="num">{f(d, avail)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
