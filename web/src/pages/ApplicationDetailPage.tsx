import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useRole } from '../App';
import {
  KIND_TEXT,
  READING_STATUS_TEXT,
  STATUS_TEXT,
  type Application,
  type Bill,
} from '../types';

/** 申请详情：状态流转操作（电工验收/换表/核表/拆线，班组停用/录数）+ 读数链 + 账单 */
export default function ApplicationDetailPage() {
  const { id } = useParams();
  const appId = Number(id);
  const { role, teamId, electrician } = useRole();
  const [app, setApp] = useState<Application | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const a = await api.get<Application>(`/applications/${appId}`);
    setApp(a);
    try {
      setBill(await api.get<Bill>(`/applications/${appId}/bill`));
    } catch {
      setBill(null);
    }
  }, [appId]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(okMsg);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!app) return <p>{error || '加载中…'}</p>;

  const isMine = role === 'team' && app.teamId === teamId;
  const activeMeter = app.meters.find((m) => m.status === 'ACTIVE');

  return (
    <div>
      <h2>
        申请 #{app.id} · {app.team.name} · {app.box.code}
        <span className={`tag status-${app.status}`} style={{ marginLeft: 8 }}>
          {STATUS_TEXT[app.status]}
        </span>
      </h2>
      <p className="muted">
        用途：{app.purpose}　计划：{app.plannedStart.slice(0, 10)} ~{' '}
        {app.plannedEnd.slice(0, 10)}
      </p>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <div className="actions">
        {role === 'electrician' && app.status === 'PENDING' && (
          <ApproveForm
            onSubmit={(meterCode, initialReading) =>
              act(
                () =>
                  api.post(`/applications/${appId}/approve`, {
                    meterCode,
                    initialReading,
                    electrician,
                    wiringConfirmed: true,
                  }),
                '已验收开通供电',
              )
            }
            onReject={() =>
              act(
                () => api.post(`/applications/${appId}/reject`, { electrician }),
                '已驳回并释放电箱',
              )
            }
          />
        )}
        {isMine && app.status === 'PENDING' && (
          <button onClick={() => act(() => api.post(`/applications/${appId}/cancel`), '已取消并释放电箱')}>
            取消申请
          </button>
        )}
        {isMine && app.status === 'ACTIVE' && (
          <>
            <Link className="button" to={`/m/${appId}/reading`}>
              手机录数
            </Link>
            <button onClick={() => act(() => api.post(`/applications/${appId}/stop`), '已申请停用，等待电工核表')}>
              申请停用
            </button>
          </>
        )}
        {role === 'electrician' && app.status === 'ACTIVE' && (
          <SwapForm
            onSubmit={(oldFinal, newCode, newInitial) =>
              act(
                () =>
                  api.post(`/applications/${appId}/swap-meter`, {
                    oldFinal,
                    newCode,
                    newInitial,
                    electrician,
                  }),
                '换表完成，用量分段接续',
              )
            }
          />
        )}
        {role === 'electrician' && app.status === 'STOPPING' && (
          <FinalizeForm
            onSubmit={(value, confirmAbnormal) =>
              act(
                () =>
                  api.post(`/applications/${appId}/finalize`, {
                    value,
                    electrician,
                    confirmAbnormal,
                  }),
                '末次读数已核对，账单已生成',
              )
            }
          />
        )}
        {role === 'electrician' && app.status === 'AWAIT_DISCONNECT' && (
          <button
            className="danger"
            onClick={() =>
              act(
                () => api.post(`/applications/${appId}/disconnect`, { electrician }),
                '已确认拆线，电箱释放',
              )
            }
          >
            确认拆线并释放电箱
          </button>
        )}
      </div>

      <h3>电表</h3>
      <table className="table">
        <thead>
          <tr>
            <th>表编号</th>
            <th>初值</th>
            <th>末值</th>
            <th>状态</th>
            <th>装/拆时间</th>
          </tr>
        </thead>
        <tbody>
          {app.meters.map((m) => (
            <tr key={m.id}>
              <td>{m.code}</td>
              <td>{m.initialReading}</td>
              <td>{m.finalReading ?? '—'}</td>
              <td>{m.status === 'ACTIVE' ? '在用' : m.status === 'REPLACED' ? '已换下' : '已结算'}</td>
              <td className="muted">
                {m.installedAt.slice(0, 16).replace('T', ' ')}
                {m.removedAt ? ` ~ ${m.removedAt.slice(0, 16).replace('T', ' ')}` : ''}
              </td>
            </tr>
          ))}
          {app.meters.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                验收开通后登记电表
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>读数记录</h3>
      <table className="table">
        <thead>
          <tr>
            <th>时间</th>
            <th>表</th>
            <th>读数</th>
            <th>类型</th>
            <th>状态</th>
            <th>录数人</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {app.readings.map((r) => (
            <tr key={r.id} className={r.status !== 'CONFIRMED' ? 'row-warn' : ''}>
              <td className="muted">{r.recordedAt.slice(0, 16).replace('T', ' ')}</td>
              <td>{app.meters.find((m) => m.id === r.meterId)?.code}</td>
              <td>{r.value}</td>
              <td>{KIND_TEXT[r.kind] ?? r.kind}</td>
              <td>{READING_STATUS_TEXT[r.status]}</td>
              <td>{r.recordedBy}</td>
              <td className="muted">{r.reviewNote ?? ''}</td>
            </tr>
          ))}
          {app.readings.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                暂无读数
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {bill?.detail && <BillView bill={bill} />}
      {activeMeter && app.status === 'ACTIVE' && (
        <p className="muted">在用电表：{activeMeter.code}（初值 {activeMeter.initialReading}）</p>
      )}
    </div>
  );
}

function ApproveForm({
  onSubmit,
  onReject,
}: {
  onSubmit: (meterCode: string, initial: number) => void;
  onReject: () => void;
}) {
  const [meterCode, setMeterCode] = useState('');
  const [initial, setInitial] = useState('');
  const [wiringOk, setWiringOk] = useState(false);
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(meterCode, Number(initial));
      }}
    >
      <strong>电工验收：</strong>
      <input
        placeholder="表编号 如 M-101"
        value={meterCode}
        onChange={(e) => setMeterCode(e.target.value)}
        required
      />
      <input
        placeholder="起始读数"
        type="number"
        step="0.01"
        min="0"
        value={initial}
        onChange={(e) => setInitial(e.target.value)}
        required
      />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={wiringOk}
          onChange={(e) => setWiringOk(e.target.checked)}
        />
        接线安全已验收
      </label>
      <button type="submit" disabled={!wiringOk}>
        验收通过并开通
      </button>
      <button type="button" className="danger" onClick={onReject}>
        驳回
      </button>
    </form>
  );
}

function SwapForm({
  onSubmit,
}: {
  onSubmit: (oldFinal: number, newCode: string, newInitial: number) => void;
}) {
  const [oldFinal, setOldFinal] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newInitial, setNewInitial] = useState('');
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Number(oldFinal), newCode, Number(newInitial));
      }}
    >
      <strong>中途换表：</strong>
      <input
        placeholder="旧表末值"
        type="number"
        step="0.01"
        min="0"
        value={oldFinal}
        onChange={(e) => setOldFinal(e.target.value)}
        required
      />
      <input
        placeholder="新表编号"
        value={newCode}
        onChange={(e) => setNewCode(e.target.value)}
        required
      />
      <input
        placeholder="新表初值"
        type="number"
        step="0.01"
        min="0"
        value={newInitial}
        onChange={(e) => setNewInitial(e.target.value)}
        required
      />
      <button type="submit">确认换表</button>
    </form>
  );
}

function FinalizeForm({
  onSubmit,
}: {
  onSubmit: (value: number, confirmAbnormal: boolean) => void;
}) {
  const [value, setValue] = useState('');
  const [confirmAbnormal, setConfirmAbnormal] = useState(false);
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Number(value), confirmAbnormal);
      }}
    >
      <strong>停用核表：</strong>
      <input
        placeholder="末次读数"
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
      />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={confirmAbnormal}
          onChange={(e) => setConfirmAbnormal(e.target.checked)}
        />
        读数异常已现场核实
      </label>
      <button type="submit">核对末次读数并结算</button>
    </form>
  );
}

export function BillView({ bill }: { bill: Bill }) {
  const d = bill.detail!;
  return (
    <div className="bill">
      <h3>结算账单</h3>
      <div className="bill-summary">
        <div>
          <div className="num">{bill.totalUsage}</div>
          <div className="muted">总用量（度）</div>
        </div>
        <div>
          <div className="num">{bill.unitPrice}</div>
          <div className="muted">单价（元/度）</div>
        </div>
        <div>
          <div className="num">¥{bill.totalAmount}</div>
          <div className="muted">应收金额</div>
        </div>
      </div>

      <h4>分段用量（换表接续）</h4>
      <table className="table">
        <thead>
          <tr>
            <th>表编号</th>
            <th>初值</th>
            <th>末值</th>
            <th>用量（度）</th>
          </tr>
        </thead>
        <tbody>
          {d.segments.map((s) => (
            <tr key={s.meterId}>
              <td>{s.meterCode}</td>
              <td>{s.start}</td>
              <td>{s.end}</td>
              <td>{s.usage}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {d.monthly.length > 1 && (
        <>
          <h4>逐月用量</h4>
          <table className="table">
            <thead>
              <tr>
                <th>月份</th>
                <th>用量（度）</th>
              </tr>
            </thead>
            <tbody>
              {d.monthly.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{m.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h4>完整读数链（核对使用过程）</h4>
      <table className="table">
        <thead>
          <tr>
            <th>时间</th>
            <th>表</th>
            <th>读数</th>
            <th>类型</th>
            <th>录数人</th>
          </tr>
        </thead>
        <tbody>
          {d.readings.map((r) => (
            <tr key={r.id}>
              <td className="muted">{r.recordedAt.slice(0, 16).replace('T', ' ')}</td>
              <td>{r.meterCode}</td>
              <td>{r.value}</td>
              <td>{KIND_TEXT[r.kind] ?? r.kind}</td>
              <td>{r.recordedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
