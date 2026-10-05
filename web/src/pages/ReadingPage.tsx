import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useRole } from '../App';
import { KIND_TEXT, type Application } from '../types';

interface Previous {
  meterCode: string;
  previous: { value: number; recordedAt: string; kind: string };
}

interface SubmitResult {
  reading: { id: number; value: number; status: string };
  previous: { value: number };
  delta: number;
  reviewReason: string | null;
  message: string;
}

/** 手机录数页：大字展示上一笔读数，倒退/异常跃升自动进入复核 */
export default function ReadingPage() {
  const { id } = useParams();
  const appId = Number(id);
  const { teamId } = useRole();
  const [app, setApp] = useState<Application | null>(null);
  const [prev, setPrev] = useState<Previous | null>(null);
  const [value, setValue] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get<Application>(`/applications/${appId}`).then(setApp).catch((e) => setError(e.message));
    api
      .get<Previous>(`/applications/${appId}/previous-reading`)
      .then(setPrev)
      .catch(() => setPrev(null));
  };

  useEffect(load, [appId]);

  const num = Number(value);
  const warn =
    prev && value !== '' && !Number.isNaN(num)
      ? num < prev.previous.value
        ? `比上一笔 ${prev.previous.value} 还低，将转入电工复核`
        : num - prev.previous.value > 500
          ? `比上一笔增加 ${(num - prev.previous.value).toFixed(1)} 度，超过阈值将转入复核`
          : ''
      : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const recorder = app?.team?.name ? `${app.team.name}录数员` : '录数员';
      const r = await api.post<SubmitResult>(`/applications/${appId}/readings`, {
        value: num,
        recordedBy: recorder,
      });
      setResult(r);
      setValue('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!app) return <p className="page">{error || '加载中…'}</p>;

  return (
    <div className="mobile-page">
      <h2>手机抄表 · {app.box.code}</h2>
      <p className="muted">
        {app.team.name} · 表号 {prev?.meterCode ?? '—'}
      </p>

      {prev && (
        <div className="prev-card">
          <div className="muted">上一笔读数（{KIND_TEXT[prev.previous.kind] ?? prev.previous.kind}）</div>
          <div className="prev-value">{prev.previous.value}</div>
          <div className="muted">
            {prev.previous.recordedAt.slice(0, 16).replace('T', ' ')}
          </div>
        </div>
      )}

      {app.status !== 'ACTIVE' ? (
        <p className="error">当前状态不可录数（需供电中）。</p>
      ) : (
        <form onSubmit={submit} className="reading-form">
          <label>本次读数（度）</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="输入电表当前示数"
            required
            autoFocus
          />
          {warn && <p className="warn">⚠ {warn}</p>}
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || value === ''}>
            {busy ? '提交中…' : '提交读数'}
          </button>
        </form>
      )}

      {result && (
        <div className={`result ${result.reviewReason ? 'warn-box' : 'ok-box'}`}>
          <strong>{result.message}</strong>
          <div>
            本次 {result.reading.value}，较上一笔 {result.delta >= 0 ? '+' : ''}
            {result.delta.toFixed(1)} 度
          </div>
          {result.reviewReason && (
            <div className="muted">复核通过前该笔不计入费用，电工将在复核列表中处理。</div>
          )}
        </div>
      )}

      <p>
        <Link to={`/applications/${appId}`}>← 返回申请详情</Link>
      </p>
    </div>
  );
}
