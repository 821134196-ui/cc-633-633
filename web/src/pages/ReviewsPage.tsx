import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useRole } from '../App';
import type { PendingReview } from '../types';

/** 电工复核列表：处理倒退/异常跃升的读数 */
export default function ReviewsPage() {
  const { electrician } = useRole();
  const [items, setItems] = useState<PendingReview[]>([]);
  const [error, setError] = useState('');

  const load = () =>
    api
      .get<PendingReview[]>('/reviews')
      .then(setItems)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const review = async (id: number, approve: boolean) => {
    const note = approve ? '' : window.prompt('驳回原因（会展示给班组）') ?? '';
    try {
      await api.post(`/readings/${id}/review`, { approve, reviewedBy: electrician, note });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <h2>读数复核（{items.length}）</h2>
      {error && <p className="error">{error}</p>}
      {items.length === 0 && <p className="muted">没有待复核的读数。</p>}
      {items.map((r) => (
        <div key={r.id} className="review-card">
          <div>
            <strong>
              {r.application.box.code} · {r.application.team.name} · 表 {r.meter.code}
            </strong>
            <div className="muted">
              {r.recordedAt.slice(0, 16).replace('T', ' ')} · 录数人 {r.recordedBy}
            </div>
            <div>
              本次读数 <strong>{r.value}</strong>
            </div>
            <div className="warn">⚠ {r.reviewNote}</div>
          </div>
          <div className="review-actions">
            <button onClick={() => review(r.id, true)}>复核通过（计入）</button>
            <button className="danger" onClick={() => review(r.id, false)}>
              驳回（不计费）
            </button>
            <Link to={`/applications/${r.application.id}`}>查看申请</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
