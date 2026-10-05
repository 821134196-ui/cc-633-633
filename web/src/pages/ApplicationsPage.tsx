import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useRole } from '../App';
import { STATUS_TEXT, type Application } from '../types';

/** 申请记录列表（班组看自己的，电工看全部） */
export default function ApplicationsPage() {
  const { role, teamId } = useRole();
  const [apps, setApps] = useState<Application[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const query = role === 'team' ? `?teamId=${teamId}` : '';
    api
      .get<Application[]>(`/applications${query}`)
      .then(setApps)
      .catch((e) => setError(e.message));
  }, [role, teamId]);

  return (
    <div>
      <h2>申请记录{role === 'team' ? '（本班组）' : '（全部）'}</h2>
      {error && <p className="error">{error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>班组</th>
            <th>电箱</th>
            <th>用途</th>
            <th>计划用电时间</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.id}>
              <td>{a.id}</td>
              <td>{a.team.name}</td>
              <td>{a.box.code}</td>
              <td>{a.purpose}</td>
              <td className="muted">
                {a.plannedStart.slice(0, 10)} ~ {a.plannedEnd.slice(0, 10)}
              </td>
              <td>
                <span className={`tag status-${a.status}`}>
                  {STATUS_TEXT[a.status] ?? a.status}
                </span>
              </td>
              <td>
                <Link to={`/applications/${a.id}`}>详情</Link>
                {a.status === 'ACTIVE' && (
                  <>
                    {' · '}
                    <Link to={`/m/${a.id}/reading`}>录数</Link>
                  </>
                )}
              </td>
            </tr>
          ))}
          {apps.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                暂无申请
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
