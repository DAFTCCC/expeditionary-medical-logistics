import { useState } from 'react';
import type { LedgerEvent } from '../../core/types';
import { describeEvent, EVENT_LABEL, eventHubs } from '../model';
import { useStore } from '../store';
import { Empty, Time, useSession } from '../ui';

const PAGE = 60;

export function HistoryPage({ params }: { params: URLSearchParams }) {
  const { p, L } = useStore();
  const { scope, tz } = useSession();
  const [type, setType] = useState(params.get('type') ?? '');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const rows = [...p.events].reverse()
    .filter((e) => scope === 'ALL' || eventHubs(e, p, L).has(scope))
    .filter((e) => !type || e.type === type)
    .filter((e) => !who || e.actorId === who)
    .map((e) => ({ e, text: describeEvent(e, p, L) }))
    .filter((r) => !q || r.text.toLowerCase().includes(q.toLowerCase()) || r.e.id.includes(q));

  const csv = () => {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = [['time_utc', 'event', 'description', 'recorded_by', 'device', 'sync', 'event_id'].join(',')];
    for (const { e, text } of rows) lines.push([e.at, e.type, text, L.personName(e.actorId), e.deviceId, e.sync, e.id].map(esc).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fieldline-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="page-head">
        <h1>Transaction history</h1>
        <span className="sub">{L.scopeName(scope)} · newest first · times shown in {tz ?? 'this device’s time zone'}, stored in UTC · entries are never edited or deleted</span>
      </div>
      <div className="filters">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Event type">
          <option value="">All event types</option>
          {(Object.keys(EVENT_LABEL) as LedgerEvent['type'][]).map((t) => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}
        </select>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Recorded by">
          <option value="">Anyone</option>
          {L.ref.people.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
        </select>
        <input type="search" placeholder="Search descriptions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search history" />
        <button className="btn secondary" onClick={csv} disabled={!rows.length}>Export CSV ({rows.length})</button>
      </div>
      {rows.length === 0 && <Empty>No transactions match.</Empty>}
      <ol className="history">
        {rows.slice(0, limit).map(({ e, text }) => (
          <li key={e.id} className={`ev ev-${e.type.toLowerCase()}`}>
            <div className="ev-head">
              <span className="ev-type">{EVENT_LABEL[e.type]}</span>
              <Time iso={e.at} />
            </div>
            <p>{text}</p>
            <p className="sub">Recorded by {L.personName(e.actorId)} · device {e.deviceId} · {e.sync.toLowerCase()} · <code>{e.id.slice(0, 13)}</code>{e.note ? ` · note: ${e.note}` : ''}</p>
          </li>
        ))}
      </ol>
      {rows.length > limit && <button className="btn secondary" onClick={() => setLimit(limit + PAGE)}>Show more ({rows.length - limit} older)</button>}
    </>
  );
}
