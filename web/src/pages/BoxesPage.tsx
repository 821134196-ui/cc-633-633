import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { STATUS_TEXT, type Box } from '../types';

/** 电箱看板：一眼看出每个电箱空闲/占用/待拆线 */
export default function BoxesPage() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [error, setError] = useState('');

  const load = () =>
    api
      .get<Box[]>('/boxes')
      .then(setBoxes)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div>
      <h2>电箱看板</h2>
      {error && <p className="error">{error}</p>}
      <div className="box-grid">
        {boxes.map((b) => (
          <div key={b.id} className={`box-card ${b.occupied ? 'occupied' : 'idle'}`}>
            <div className="box-head">
              <strong>{b.code}</strong>
              <span className={`tag status-${b.status}`}>
                {STATUS_TEXT[b.status] ?? b.status}
              </span>
            </div>
            <div className="box-meta">
              {b.location} · {b.capacityKw}kW
            </div>
            {b.currentApplication ? (
              <div className="box-current">
                <div>{b.currentApplication.teamName}</div>
                <div className="muted">{b.currentApplication.purpose}</div>
                <Link to={`/applications/${b.currentApplication.id}`}>查看申请 →</Link>
              </div>
            ) : (
              <div className="box-current muted">空闲，可申请</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
