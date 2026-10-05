import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useRole } from '../App';
import type { Box } from '../types';

/** 班组填写用电申请：电箱、用电时间、用途 */
export default function ApplyPage() {
  const { teamId } = useRole();
  const nav = useNavigate();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxId, setBoxId] = useState<number>(0);
  const [purpose, setPurpose] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Box[]>('/boxes').then((bs) => {
      setBoxes(bs);
      const firstFree = bs.find((b) => !b.occupied);
      if (firstFree) setBoxId(firstFree.id);
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const app = await api.post<{ id: number }>('/applications', {
        teamId,
        boxId,
        purpose,
        plannedStart: new Date(plannedStart).toISOString(),
        plannedEnd: new Date(plannedEnd).toISOString(),
      });
      nav(`/applications/${app.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow">
      <h2>临时用电申请</h2>
      <form onSubmit={submit} className="card form">
        <label>
          配电箱（仅空闲可选）
          <select value={boxId} onChange={(e) => setBoxId(Number(e.target.value))}>
            {boxes.map((b) => (
              <option key={b.id} value={b.id} disabled={b.occupied}>
                {b.code} · {b.location} · {b.capacityKw}kW
                {b.occupied ? '（占用中）' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          用电用途
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="如：钢筋切断机、弯曲机用电"
            required
          />
        </label>
        <label>
          计划开始时间
          <input
            type="datetime-local"
            value={plannedStart}
            onChange={(e) => setPlannedStart(e.target.value)}
            required
          />
        </label>
        <label>
          计划结束时间
          <input
            type="datetime-local"
            value={plannedEnd}
            onChange={(e) => setPlannedEnd(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !boxId}>
          提交申请
        </button>
        <p className="muted">提交后电箱即被锁定，待电工验收接线并登记起始读数后开通供电。</p>
      </form>
    </div>
  );
}
