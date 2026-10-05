import { useCallback, useEffect, useState } from 'react';
import { api, type Application, type Box, type Reading } from './api';

type Tab = 'boxes' | 'apps';

const STATUS_TEXT: Record<string, string> = {
  PENDING: '待电工验收',
  ACTIVE: '供电中',
  STOPPED: '已停用·待拆线',
  RELEASED: '已拆线释放',
  REJECTED: '验收驳回',
};

const KIND_TEXT: Record<string, string> = {
  INITIAL: '起始读数',
  INTERIM: '中途录数',
  OLD_FINAL: '旧表末值',
  NEW_INITIAL: '新表初值',
  FINAL: '末次读数',
};

function fmtDateTime(s: string) {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toLocalInput(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('boxes');
  const [detailId, setDetailId] = useState<string | null>(null);

  if (detailId) {
    return <AppDetail id={detailId} onBack={() => setDetailId(null)} onChange={() => {}} />;
  }
  return (
    <div className="app">
      <div className="topbar">
        <h1>工地临时用电</h1>
        <div className="sub">申请 · 验收录数 · 换表 · 跨月结算 · 拆线释放</div>
      </div>
      {tab === 'boxes' ? (
        <BoxesPage onOpen={setDetailId} goApps={() => setTab('apps')} />
      ) : (
        <AppsPage onOpen={setDetailId} />
      )}
      <nav className="tabs">
        <button className={tab === 'boxes' ? 'active' : ''} onClick={() => setTab('boxes')}>
          <span className="ico">🔌</span>电箱
        </button>
        <button className={tab === 'apps' ? 'active' : ''} onClick={() => setTab('apps')}>
          <span className="ico">📋</span>用电申请
        </button>
      </nav>
    </div>
  );
}

/* ---------------- 电箱页 ---------------- */

function BoxesPage({ onOpen, goApps }: { onOpen: (id: string) => void; goApps: () => void }) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, a] = await Promise.all([api.listBoxes(), api.listApps()]);
      setBoxes(b);
      setApps(a);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page">
      {error && <div className="error">⚠️ {error}（请确认后端已启动）</div>}
      <button className="btn" onClick={() => setShowForm((v) => !v)}>
        ＋ 班组申请临时用电
      </button>
      {showForm && <ApplyForm onDone={(id) => { setShowForm(false); onOpen(id); }} onCancel={() => setShowForm(false)} />}

      <h3 style={{ margin: '16px 2px 8px' }}>电箱占用情况</h3>
      {boxes.map((box) => {
        const app = box.currentApplication;
        return (
          <div key={box.id} className="card clickable" onClick={() => app && onOpen(app.id)}>
            <div className="row">
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {box.code} <span className="muted" style={{ fontWeight: 400 }}>{box.name}</span>
                </div>
                <div className="muted">{box.location ?? '—'}</div>
              </div>
              <span className={`badge ${box.status}`}>{box.status === 'FREE' ? '空闲可申请' : '占用中'}</span>
            </div>
            {app && (
              <div className="muted" style={{ marginTop: 6 }}>
                当前：{app.team.name} · <span className="code">{app.code}</span> ·{' '}
                <span className={`badge ${app.status}`}>{STATUS_TEXT[app.status]}</span>
                {app.status === 'STOPPED' && (
                  <div style={{ marginTop: 4, color: 'var(--amber)' }}>
                    ⚠ 停用 ≠ 空闲，电工拆线后才可重新分配
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="muted" style={{ textAlign: 'center', marginTop: 8 }} onClick={goApps}>
        全部 {apps.length} 笔申请 →
      </div>
    </div>
  );
}

function ApplyForm({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [form, setForm] = useState({
    teamName: '',
    contact: '',
    boxCode: '',
    purpose: '',
    plannedStart: toLocalInput(),
    plannedEnd: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listBoxes().then((b) => {
      setBoxes(b);
      const firstFree = b.find((x) => x.status === 'FREE');
      if (firstFree) setForm((f) => ({ ...f, boxCode: firstFree.code }));
    });
  }, []);

  async function submit() {
    setError('');
    if (!form.teamName || !form.purpose || !form.boxCode) {
      setError('请填写班组、用途并选择电箱');
      return;
    }
    setBusy(true);
    try {
      const app = await api.apply({
        ...form,
        plannedEnd: form.plannedEnd || undefined,
      });
      onDone(app.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2>新申请</h2>
      {error && <div className="error">{error}</div>}
      <label>班组名称 *</label>
      <input value={form.teamName} onChange={(e) => setForm({ ...form, teamName: e.target.value })} placeholder="如：钢筋一班" />
      <label>联系人电话</label>
      <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
      <label>电箱 *</label>
      <select value={form.boxCode} onChange={(e) => setForm({ ...form, boxCode: e.target.value })}>
        {boxes.map((b) => (
          <option key={b.id} value={b.code} disabled={b.status === 'OCCUPIED'}>
            {b.code} {b.name}（{b.status === 'FREE' ? '空闲' : '占用中'}）
          </option>
        ))}
      </select>
      <label>用电用途 *</label>
      <textarea rows={2} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="如：钢筋切断机、弯曲机用电" />
      <label>计划开始 *</label>
      <input type="datetime-local" value={form.plannedStart} onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} />
      <label>计划结束（跨月可留空，按实际停用结算）</label>
      <input type="datetime-local" value={form.plannedEnd} onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} />
      <div className="btn-row">
        <button className="btn secondary" onClick={onCancel}>取消</button>
        <button className="btn" disabled={busy} onClick={submit}>{busy ? '提交中…' : '提交申请'}</button>
      </div>
    </div>
  );
}

/* ---------------- 申请列表页 ---------------- */

function AppsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [apps, setApps] = useState<Application[]>([]);
  useEffect(() => {
    api.listApps().then(setApps);
  }, []);
  return (
    <div className="page">
      <h3 style={{ margin: '4px 2px 8px' }}>全部用电申请（{apps.length}）</h3>
      {apps.length === 0 && <div className="muted">暂无申请，去「电箱」页发起第一笔。</div>}
      {apps.map((a) => (
        <div key={a.id} className="card clickable" onClick={() => onOpen(a.id)}>
          <div className="row">
            <span className="code">{a.code}</span>
            <span className={`badge ${a.status}`}>{STATUS_TEXT[a.status]}</span>
          </div>
          <div className="row"><span className="k">班组</span><span className="v">{a.team.name}</span></div>
          <div className="row"><span className="k">电箱</span><span className="v">{a.box.code} {a.box.name}</span></div>
          <div className="row"><span className="k">用途</span><span className="v">{a.purpose}</span></div>
          {a.billing && (
            <div className="row">
              <span className="k">结算</span>
              <span className="v">
                {a.billing.totalUsage} kWh · ¥{a.billing.totalAmount.toFixed(2)}{' '}
                <span className={`badge ${a.billing.status}`}>{a.billing.status === 'FINAL' ? '已出账' : '待复核'}</span>
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- 申请详情（全流程） ---------------- */

function AppDetail({ id, onBack }: { id: string; onBack: () => void; onChange: () => void }) {
  const [app, setApp] = useState<Application | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    try {
      setApp(await api.getApp(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!app) return <div className="page">{error ? <div className="error">{error}</div> : '加载中…'}</div>;

  const wrap = (fn: () => Promise<unknown>) => async () => {
    setError('');
    setNotice('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pending = app.readings.filter((r) => r.status === 'PENDING_REVIEW');

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={onBack}>← 返回</button>
        <h1><span className="code">{app.code}</span></h1>
        <div className="sub">{app.team.name} · {app.box.code} · <span className={`badge ${app.status}`}>{STATUS_TEXT[app.status]}</span></div>
      </div>
      <div className="page">
        {error && <div className="error">⚠️ {error}</div>}
        {notice && <div className="ok-msg">✓ {notice}</div>}

        <div className="card">
          <div className="row"><span className="k">用途</span><span className="v">{app.purpose}</span></div>
          <div className="row"><span className="k">联系人</span><span className="v">{app.team.contact ?? '—'}</span></div>
          <div className="row"><span className="k">计划开始</span><span className="v">{fmtDateTime(app.plannedStart)}</span></div>
          <div className="row"><span className="k">供电时间</span><span className="v">{app.activatedAt ? fmtDateTime(app.activatedAt) : '—'}</span></div>
          <div className="row"><span className="k">停用时间</span><span className="v">{app.stoppedAt ? fmtDateTime(app.stoppedAt) : '—'}</span></div>
          <div className="row"><span className="k">拆线时间</span><span className="v">{app.releasedAt ? fmtDateTime(app.releasedAt) : '—'}</span></div>
          <div className="row"><span className="k">当前电表</span><span className="v code">{app.currentMeter?.code ?? '—'}</span></div>
          {app.rejectReason && <div className="alert danger">驳回原因：{app.rejectReason}</div>}
        </div>

        {app.status === 'PENDING' && <ActivatePanel app={app} onDone={wrap(reload)} />}
        {app.status === 'ACTIVE' && <ActivePanel app={app} onDone={wrap(reload)} setNotice={setNotice} />}
        {(app.status === 'STOPPED' || app.status === 'RELEASED') && (
          <BillingPanel app={app} pending={pending} onDone={wrap(reload)} setNotice={setNotice} />
        )}

        <ReadingTimeline app={app} pending={pending} onReview={wrap(reload)} />
      </div>
    </div>
  );
}

/* 电工验收接线 + 起始读数 */
function ActivatePanel({ app, onDone }: { app: Application; onDone: () => Promise<void> }) {
  const [meterCode, setMeterCode] = useState('DB-001');
  const [initialValue, setInitialValue] = useState('0');
  const [electrician, setElectrician] = useState('王电工');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="card">
      <h2>电工验收接线</h2>
      <div className="alert warn">完成接线安全检查并确认电表起始读数后，系统才会供电。</div>
      <label>电表编号</label>
      <input value={meterCode} onChange={(e) => setMeterCode(e.target.value)} />
      <label>起始读数 (kWh)</label>
      <input type="number" inputMode="decimal" value={initialValue} onChange={(e) => setInitialValue(e.target.value)} />
      <label>验收电工</label>
      <input value={electrician} onChange={(e) => setElectrician(e.target.value)} />
      <button className="btn success" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          await api.activate(app.id, { meterCode, initialValue: Number(initialValue), electrician });
          await onDone();
        } finally { setBusy(false); }
      }}>✓ 接线安全，确认起始读数并供电</button>

      {!rejecting ? (
        <button className="btn danger" onClick={() => setRejecting(true)}>接线不合格，驳回申请</button>
      ) : (
        <>
          <label>驳回原因</label>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：漏保未接、线缆截面不足" />
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setRejecting(false)}>取消</button>
            <button className="btn danger" onClick={async () => {
              if (!reason) return;
              await api.reject(app.id, reason);
              await onDone();
            }}>确认驳回并释放电箱</button>
          </div>
        </>
      )}
    </div>
  );
}

/* 供电中：手机录数 / 换表 / 停用 */
function ActivePanel({ app, onDone, setNotice }: {
  app: Application;
  onDone: () => Promise<void>;
  setNotice: (s: string) => void;
}) {
  const readings = app.readings;
  const prev = readings.length ? readings[readings.length - 1] : null;

  const [value, setValue] = useState('');
  const [recordedAt, setRecordedAt] = useState(toLocalInput());
  const [anomaly, setAnomaly] = useState<string | null>(null);
  const [lastRecorded, setLastRecorded] = useState<Reading | null>(null);

  const [showChange, setShowChange] = useState(false);
  const [ch, setCh] = useState({ oldFinal: '', newCode: `DB-${String(Math.floor(Math.random() * 900) + 100)}`, newInitial: '0', at: toLocalInput() });

  const [showStop, setShowStop] = useState(false);
  const [finalValue, setFinalValue] = useState('');
  const [stopAt, setStopAt] = useState(toLocalInput());

  async function submitReading() {
    const r = await api.record(app.id, { value: Number(value), recordedAt: new Date(recordedAt).toISOString() });
    setAnomaly(r.anomaly);
    setLastRecorded(r.reading);
    setValue('');
    if (r.anomaly) {
      setNotice('');
    } else {
      setNotice('录数成功');
    }
    await onDone();
  }

  return (
    <>
      <div className="card">
        <h2>📱 手机录数</h2>
        <div className="prev-reading">
          <div className="meta">上一笔读数{prev ? `（${KIND_TEXT[prev.kind]} · 表 ${prev.meter?.code}）` : ''}</div>
          <div className="big">{prev ? prev.value : '—'} <span style={{ fontSize: 14 }}>kWh</span></div>
          <div className="meta">{prev ? fmtDateTime(prev.recordedAt) : '验收后将出现起始读数'}</div>
        </div>
        <label>本次读数 (kWh) *</label>
        <input type="number" inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setAnomaly(null); }} placeholder={`必须 ≥ 上一笔 ${prev?.value ?? 0}`} />
        <label>抄表时间</label>
        <input type="datetime-local" value={recordedAt} onChange={(e) => setRecordedAt(e.target.value)} />
        <button className="btn" disabled={!value} onClick={submitReading}>提交读数</button>
        {anomaly && (
          <div className="alert danger">
            🚫 该读数已进入复核，<b>不会直接计算收费</b>：<br />{anomaly}
            <div className="muted" style={{ marginTop: 4 }}>请电工在下方读数记录中「确认无误」或「修正读数」。</div>
          </div>
        )}
        {lastRecorded && !anomaly && <div className="alert" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>已记录 #{lastRecorded.seq}</div>}
      </div>

      <div className="card">
        <h2>中途换表</h2>
        {!showChange ? (
          <button className="btn secondary" onClick={() => setShowChange(true)}>更换电表</button>
        ) : (
          <>
            <div className="alert warn">需同时记录旧表末值与新表初值，系统分段接续计算实际用量。</div>
            <label>旧表 {app.currentMeter?.code} 末值 *</label>
            <input type="number" value={ch.oldFinal} onChange={(e) => setCh({ ...ch, oldFinal: e.target.value })} placeholder={`≥ 上一笔 ${prev?.value ?? 0}`} />
            <label>新表编号 *</label>
            <input value={ch.newCode} onChange={(e) => setCh({ ...ch, newCode: e.target.value })} />
            <label>新表初值 *</label>
            <input type="number" value={ch.newInitial} onChange={(e) => setCh({ ...ch, newInitial: e.target.value })} />
            <label>换表时间</label>
            <input type="datetime-local" value={ch.at} onChange={(e) => setCh({ ...ch, at: e.target.value })} />
            <div className="btn-row">
              <button className="btn secondary" onClick={() => setShowChange(false)}>取消</button>
              <button className="btn" onClick={async () => {
                await api.changeMeter(app.id, {
                  oldFinalValue: Number(ch.oldFinal),
                  newMeterCode: ch.newCode,
                  newInitialValue: Number(ch.newInitial),
                  changedAt: new Date(ch.at).toISOString(),
                });
                setShowChange(false);
                setNotice('换表完成，用量将分段接续');
                await onDone();
              }}>确认换表</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>停用结算</h2>
        {!showStop ? (
          <button className="btn danger" onClick={() => setShowStop(true)}>停用并核对末次读数</button>
        ) : (
          <>
            <div className="prev-reading">
              <div className="meta">上一笔读数（{prev ? KIND_TEXT[prev.kind] : '—'}）</div>
              <div className="big">{prev?.value ?? '—'}</div>
            </div>
            <label>末次读数 (kWh) *</label>
            <input type="number" value={finalValue} onChange={(e) => setFinalValue(e.target.value)} />
            <label>停用时间</label>
            <input type="datetime-local" value={stopAt} onChange={(e) => setStopAt(e.target.value)} />
            <div className="btn-row">
              <button className="btn secondary" onClick={() => setShowStop(false)}>取消</button>
              <button className="btn danger" disabled={!finalValue} onClick={async () => {
                await api.stop(app.id, { finalValue: Number(finalValue), recordedAt: new Date(stopAt).toISOString() });
                await onDone();
              }}>确认停用，生成账单</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* 账单：用量、费用、月度分摊、拆线 */
function BillingPanel({ app, pending, onDone, setNotice }: {
  app: Application;
  pending: Reading[];
  onDone: () => Promise<void>;
  setNotice: (s: string) => void;
}) {
  const b = app.billingParsed;
  const final = b?.status === 'FINAL';
  return (
    <>
      <div className={`total-box ${final ? '' : 'pending'}`}>
        <div className="lab">{final ? '结算账单（最终）' : '暂挂账单 · 存在待复核读数'}</div>
        <div className="num">{b?.totalUsage ?? 0} kWh</div>
        <div className="lab">¥ {b?.totalAmount.toFixed(2) ?? '0.00'}（单价 ¥{b?.unitPrice ?? 1.2}/kWh）</div>
      </div>

      {pending.length > 0 && (
        <div className="alert danger">
          有 {pending.length} 笔读数待复核，相关用量暂不计费；全部处理后自动转为最终账单。
        </div>
      )}

      {b && b.segments.length > 0 && (
        <div className="card">
          <h2>用量分段{app.meterChanges.length > 0 && `（含 ${app.meterChanges.length} 次换表）`}</h2>
          <table>
            <thead><tr><th>电表</th><th className="num">起 → 止</th><th className="num">用量</th><th>状态</th></tr></thead>
            <tbody>
              {b.segments.map((s, i) => (
                <tr key={i}>
                  <td className="code">{s.meterCode}</td>
                  <td className="num">{s.fromValue} → {s.toValue}</td>
                  <td className="num">{s.usage}</td>
                  <td>{s.billed ? <span className="badge OK">计费</span> : <span className="badge PENDING_REVIEW">挂起</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {b && b.monthly.length > 0 && (
        <div className="card">
          <h2>跨月结算明细</h2>
          <table>
            <thead><tr><th>月份</th><th className="num">天数</th><th className="num">用量(kWh)</th><th className="num">金额(元)</th></tr></thead>
            <tbody>
              {b.monthly.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="num">{m.days}</td>
                  <td className="num">{m.usage.toFixed(2)}</td>
                  <td className="num">{m.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ marginTop: 8 }}>
            合计 {b.totalUsage} kWh 与读数链差值一致；读数保留完整使用过程，可逐月核对。
          </div>
        </div>
      )}

      {app.status === 'STOPPED' && (
        <div className="card">
          <h2>电工拆线</h2>
          <div className="alert warn">停用只代表不再用电；电箱仍被占用。电工现场拆线确认后才会释放，届时才可分配给其他班组。</div>
          <button
            className="btn success"
            disabled={!final}
            onClick={async () => {
              await api.release(app.id, '王电工');
              setNotice('拆线完成，电箱已释放');
              await onDone();
            }}
          >
            {final ? '✓ 确认拆线，释放电箱' : '有待复核读数，处理后才能拆线'}
          </button>
        </div>
      )}
      {app.status === 'RELEASED' && <div className="ok-msg">此电箱已拆线释放，可重新分配给新班组。</div>}
    </>
  );
}

/* 读数时间线 + 复核操作 */
function ReadingTimeline({ app, pending, onReview }: {
  app: Application;
  pending: Reading[];
  onReview: () => Promise<void>;
}) {
  return (
    <div className="card">
      <h2>读数记录（{app.readings.length}）</h2>
      {app.readings.map((r) => (
        <div key={r.id} className="timeline-item">
          <div className={`dot ${r.status === 'PENDING_REVIEW' ? 'review' : ''}`} />
          <div style={{ flex: 1 }}>
            <div className="d">
              <b>{r.value}</b> kWh · {KIND_TEXT[r.kind]} · <span className="code">{r.meter?.code}</span>{' '}
              <span className={`badge ${r.status}`}>
                {r.status === 'PENDING_REVIEW' ? '待复核' : r.status === 'CONFIRMED' ? '复核确认' : '正常'}
              </span>
            </div>
            <div className="t">#{r.seq} · {fmtDateTime(r.recordedAt)}{r.reviewer ? ` · 复核人 ${r.reviewer}` : ''}</div>
            {r.anomalyReason && <div className="alert danger" style={{ margin: '6px 0' }}>{r.anomalyReason}</div>}
            {r.note && <div className="muted">{r.note}</div>}
            {r.status === 'PENDING_REVIEW' && <ReviewActions app={app} reading={r} onDone={onReview} />}
          </div>
        </div>
      ))}
      {app.readings.length === 0 && <div className="muted">暂无读数</div>}
    </div>
  );
}

function ReviewActions({ app, reading, onDone }: { app: Application; reading: Reading; onDone: () => Promise<void> }) {
  const [correcting, setCorrecting] = useState(false);
  const [val, setVal] = useState(String(reading.value));
  return (
    <div style={{ marginTop: 8 }}>
      {correcting ? (
        <>
          <label>修正为 (kWh)</label>
          <input type="number" value={val} onChange={(e) => setVal(e.target.value)} />
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setCorrecting(false)}>取消</button>
            <button className="btn" onClick={async () => {
              await api.review(app.id, reading.id, { action: 'CORRECT', correctedValue: Number(val), reviewer: '王电工' });
              await onDone();
            }}>提交修正</button>
          </div>
        </>
      ) : (
        <div className="btn-row">
          <button className="btn secondary" onClick={async () => {
            await api.review(app.id, reading.id, { action: 'CONFIRM', reviewer: '王电工' });
            await onDone();
          }}>现场确认无误</button>
          <button className="btn" onClick={() => setCorrecting(true)}>修正读数</button>
        </div>
      )}
    </div>
  );
}
