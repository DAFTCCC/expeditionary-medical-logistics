import { useState } from 'react';
import { conservationHolds, totalsFor } from '../../core/ledger';
import type { Bucket } from '../../core/types';
import { BUCKET_LABEL, describeEvent, inventory, Lookup, unitLabel, type ItemRow } from '../model';
import { useStore } from '../store';
import { Empty, ExpiryBadge, href, Section, Time, useRoute, useSession } from '../ui';

const BUCKETS: Bucket[] = ['AVAILABLE', 'CUSTODY', 'PENDING_RETURN', 'IN_TRANSIT', 'QUARANTINE', 'MISSING'];

export function InventoryPage() {
  const { p, L } = useStore();
  const { scope } = useSession();
  const { params } = useRoute();
  const [q, setQ] = useState('');
  const exp = params.get('exp');
  const low = params.get('low') === '1';
  const bucket = params.get('bucket') as Bucket | null;
  const now = new Date();

  const rows = inventory(p, L, scope, now)
    .filter((r) => !q || `${r.item.name} ${r.item.gtin ?? ''} ${r.lots.map((l) => l.lot.lotNumber).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .filter((r) => !low || r.belowReorder)
    .map((r) => ({ ...r, lots: r.lots.filter((l) => (!exp || l.expiry === exp) && (!bucket || l.byBucket[bucket] > 0)) }))
    .filter((r) => (!exp && !bucket) || r.lots.length > 0);

  return (
    <>
      <div className="page-head">
        <h1>Inventory by lot and expiry</h1>
        <span className="sub">{L.scopeName(scope)} · quantities are computed from the ledger, never stored</span>
      </div>
      <div className="filters">
        <input type="search" placeholder="Search item, GTIN or lot" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search inventory" />
        <a className={!exp && !low && !bucket ? 'chip on' : 'chip'} href={href('inventory')}>All</a>
        <a className={low ? 'chip on' : 'chip'} href={href('inventory', { low: '1' })}>Below reorder</a>
        <a className={exp === 'SOON' ? 'chip on' : 'chip'} href={href('inventory', { exp: 'SOON' })}>Expiring ≤ 90 d</a>
        <a className={exp === 'EXPIRED' ? 'chip on' : 'chip'} href={href('inventory', { exp: 'EXPIRED' })}>Expired</a>
        <a className={bucket === 'CUSTODY' ? 'chip on' : 'chip'} href={href('inventory', { bucket: 'CUSTODY' })}>In custody</a>
      </div>
      {rows.length === 0 && <Empty>No inventory matches.</Empty>}
      {rows.map((r) => <ItemCard key={r.item.id} row={r} L={L} />)}
    </>
  );
}

function ItemCard({ row, L }: { row: ItemRow; L: Lookup }) {
  const { item } = row;
  return (
    <section className="card item">
      <header className="card-head">
        <div>
          <h2>{item.name}</h2>
          <span className="sub">
            {item.category === 'MEDICATION' ? 'Medication' : 'Consumable'} · counted in {unitLabel(item.unit, 2)}{item.gtin ? ` · GTIN ${item.gtin}` : ''}
            {item.requiresWitness ? ' · witness required' : ''}
          </span>
        </div>
        <div className="item-totals">
          <span><strong>{row.available}</strong> usable</span>
          {row.availableExpired > 0 && <span className="badge bad">{row.availableExpired} expired on shelf</span>}
          {row.custody > 0 && <span>{row.custody} in custody</span>}
          {row.inTransit > 0 && <span>{row.inTransit} inbound</span>}
          {row.belowReorder && <span className="badge warn">Below reorder ({item.reorderPoint}/hub){row.lowAt.length && L.hubs().length > 1 ? ` · ${row.lowAt.map((h) => L.locationName(h)).join(', ')}` : ''}</span>}
        </div>
      </header>
      {row.lots.length === 0 ? <Empty>No stock in this scope.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Lot</th><th>Expiry</th>{BUCKETS.map((b) => <th key={b} className="num">{BUCKET_LABEL[b]}</th>)}<th>Where</th></tr>
            </thead>
            <tbody>
              {row.lots.map((l) => (
                <tr key={l.lot.id} className={l.expiry === 'EXPIRED' ? 'row-bad' : ''}>
                  <td><a href={href(`lot/${l.lot.id}`)}>{l.lot.lotNumber}</a></td>
                  <td><ExpiryBadge lot={l.lot} /></td>
                  {BUCKETS.map((b) => <td key={b} className="num">{l.byBucket[b] || ''}</td>)}
                  <td className="where">
                    {l.holders.map((h) => (
                      <span key={`${h.bucket}${h.holderId}`} className="holder">{L.holderName(h)} <span className="sub">{BUCKET_LABEL[h.bucket].toLowerCase()} {h.qty}</span></span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function LotPage({ lotId }: { lotId: string }) {
  const { p, L } = useStore();
  const { actorId } = useSession();
  const lot = p.lots.get(lotId);
  if (!lot) return <Empty>Lot not found.</Empty>;
  const item = L.items.get(lot.itemId)!;
  const t = totalsFor(p, lotId);
  const rows = [...p.balances.entries()]
    .map(([k, v]) => ({ k: k.split('|'), v }))
    .filter((r) => r.k[0] === lotId && r.v !== 0)
    .map((r) => ({ bucket: r.k[1] as Bucket, holderId: r.k[2], qty: r.v }));
  const events = p.events.filter((e) =>
    ('lotId' in e && e.lotId === lotId) || (e.type === 'RECEIVE' && e.lot.id === lotId) ||
    (e.type === 'RETURN_ACCEPT' && p.returns.get(e.returnEventId)?.lotId === lotId) ||
    (e.type === 'TRANSFER_RECEIVE' && p.shipments.get(e.shipEventId)?.lotId === lotId) ||
    (e.type === 'LABEL_ISSUE' && e.targetId === lotId),
  ).reverse();
  const labels = [...p.labels.values()].filter((l) => l.targetType === 'LOT' && l.targetId === lotId);
  const ok = conservationHolds(p, lotId);
  const myCustody = rows.find((r) => r.bucket === 'CUSTODY' && r.holderId === actorId);

  return (
    <>
      <div className="page-head">
        <h1>{item.name} · lot {lot.lotNumber}</h1>
        <ExpiryBadge lot={lot} />
      </div>
      <div className="actions-row">
        {rows.filter((r) => r.bucket === 'AVAILABLE').map((r) => (
          <a key={r.holderId} className="btn" href={href('act/issue', { lot: lotId, from: r.holderId })}>Issue from {L.locationName(r.holderId)}</a>
        ))}
        {myCustody && (
          <>
            <a className="btn" href={href('act/consume', { lot: lotId, person: actorId })}>Record use</a>
            <a className="btn" href={href('act/waste', { lot: lotId, person: actorId })}>Record waste</a>
            <a className="btn" href={href('act/return', { lot: lotId, person: actorId })}>Return</a>
          </>
        )}
        <a className="btn secondary" href={href('labels', { type: 'LOT', target: lotId })}>Label</a>
      </div>
      <div className="grid2">
        <Section title="Accountability">
          <dl className="totals">
            <dt>Received</dt><dd>{t.received}</dd>
            <dt>Issued to people</dt><dd>{t.issued}</dd>
            <dt>Consumed</dt><dd>{t.consumed}{Object.entries(t.consumedByContext).map(([c, n]) => <span key={c} className="sub"> · {c.replace('_', ' ').toLowerCase()} {n}</span>)}</dd>
            <dt>Wasted</dt><dd>{t.wasted}</dd>
            <dt>Returned (accepted)</dt><dd>{t.returned} ({t.returnAccepted})</dd>
            <dt>Disposed</dt><dd>{t.disposed}</dd>
            <dt>Reported missing</dt><dd>{t.missing}</dd>
          </dl>
          <p className={ok ? 'check ok' : 'check bad'}>
            {ok ? '✓ Every unit received is accounted for in exactly one place or outcome.' : '✗ Conservation check failed — report this.'}
          </p>
        </Section>
        <Section title="Where it is now">
          {rows.length === 0 ? <Empty>Nothing left of this lot.</Empty> : (
            <ul className="list">
              {rows.map((r) => <li key={r.bucket + r.holderId}><strong>{r.qty}</strong> {BUCKET_LABEL[r.bucket].toLowerCase()} — {L.holderName(r)}</li>)}
            </ul>
          )}
          <p className="sub">Item: {item.form ?? ''} {item.storage ? `· store ${item.storage}` : ''} · lot GTIN {lot.gtin ?? '—'}</p>
          {labels.length > 0 && <p className="sub">Labels: {labels.map((l) => `${l.code}${l.active ? '' : ' (retired)'}`).join(', ')}</p>}
        </Section>
      </div>
      <Section title="History of this lot">
        <ul className="timeline">
          {events.map((e) => (
            <li key={e.id}><Time iso={e.at} /> — {describeEvent(e, p, L)} <span className="sub">by {L.personName(e.actorId)}</span></li>
          ))}
        </ul>
      </Section>
    </>
  );
}
