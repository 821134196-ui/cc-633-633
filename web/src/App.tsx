import { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { api } from './api';
import type { Team } from './types';
import BoxesPage from './pages/BoxesPage';
import ApplyPage from './pages/ApplyPage';
import ApplicationsPage from './pages/ApplicationsPage';
import ApplicationDetailPage from './pages/ApplicationDetailPage';
import ReadingPage from './pages/ReadingPage';
import ReviewsPage from './pages/ReviewsPage';

interface RoleState {
  role: 'team' | 'electrician';
  teamId: number | null;
  electrician: string;
  setRole: (r: 'team' | 'electrician') => void;
  setTeamId: (id: number) => void;
}

const RoleContext = createContext<RoleState>(null as any);
export const useRole = () => useContext(RoleContext);

export default function App() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [role, setRole] = useState<'team' | 'electrician'>(
    () => (localStorage.getItem('role') as any) || 'team',
  );
  const [teamId, setTeamId] = useState<number>(
    () => Number(localStorage.getItem('teamId')) || 1,
  );

  useEffect(() => {
    api.get<Team[]>('/teams').then((ts) => {
      setTeams(ts);
      if (ts.length && !ts.find((t) => t.id === teamId)) setTeamId(ts[0].id);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('role', role);
    localStorage.setItem('teamId', String(teamId));
  }, [role, teamId]);

  return (
    <RoleContext.Provider
      value={{ role, teamId, electrician: '电工老王', setRole, setTeamId }}
    >
      <div className="app">
        <header className="topbar">
          <Link to="/" className="brand">
            ⚡ 施工现场临时用电
          </Link>
          <nav>
            <NavLink to="/">电箱看板</NavLink>
            <NavLink to="/apply">用电申请</NavLink>
            <NavLink to="/applications">申请记录</NavLink>
            {role === 'electrician' && <NavLink to="/reviews">读数复核</NavLink>}
          </nav>
          <div className="role-switch">
            <button
              className={role === 'team' ? 'active' : ''}
              onClick={() => setRole('team')}
            >
              班组
            </button>
            <button
              className={role === 'electrician' ? 'active' : ''}
              onClick={() => setRole('electrician')}
            >
              电工
            </button>
            {role === 'team' && (
              <select
                value={teamId}
                onChange={(e) => setTeamId(Number(e.target.value))}
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<BoxesPage />} />
            <Route path="/apply" element={<ApplyPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/applications/:id" element={<ApplicationDetailPage />} />
            <Route path="/m/:id/reading" element={<ReadingPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
          </Routes>
        </main>
      </div>
    </RoleContext.Provider>
  );
}
