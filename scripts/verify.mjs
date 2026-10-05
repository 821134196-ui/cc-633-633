#!/usr/bin/env node
/**
 * 端到端验证（需要后端运行在 http://localhost:3001）：
 *   1. 并发申请同一电箱，只允许一组成功
 *   2. 拆线前（即使已停用）不能再次分配
 *   3. 换表：旧表末值 + 新表初值，接续计算用量
 *   4. 跨月结算：月度分摊之和 == 读数链总差值
 *   5. 异常读数（倒退 / 跃升）进入复核，不直接计费；复核后才出最终账单
 *   6. 拆线释放后电箱可重新分配
 */

const BASE = process.env.API_BASE ?? 'http://localhost:3001/api';

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const boxCode = `TBOX-${stamp.slice(-6)}`;

async function createBox() {
  const { data } = await api('/boxes', {
    method: 'POST',
    body: JSON.stringify({ code: boxCode, name: '验证专用箱', location: 'verify' }),
  });
  return data;
}

async function apply(team, purpose) {
  return api('/applications', {
    method: 'POST',
    body: JSON.stringify({
      teamName: team,
      boxCode,
      purpose,
      plannedStart: '2026-01-15T08:00:00.000Z',
    }),
  });
}

async function main() {
  console.log('\n=== 施工现场临时用电系统：端到端验证 ===\n');

  // 健康检查
  const health = await api('/boxes');
  if (health.status !== 200) {
    console.error('后端未启动，请先运行 npm run start（或 npm run start:server）');
    process.exit(1);
  }
  await createBox();

  /* ---------- 检查 1：并发申请同一电箱 ---------- */
  console.log('\n[1] 并发申请同一电箱，只允许一组成功');
  const r = await Promise.all([
    apply(`班组A-${stamp}`, '用途A'),
    apply(`班组B-${stamp}`, '用途B'),
    apply(`班组C-${stamp}`, '用途C'),
  ]);
  const okCount = r.filter((x) => x.status === 201).length;
  const conflictCount = r.filter((x) => x.status === 409).length;
  check('恰好 1 组申请成功', okCount === 1, `成功 ${okCount} 组`);
  check('其余 2 组收到 409 冲突', conflictCount === 2, `冲突 ${conflictCount} 组`);

  const boxesNow = (await api('/boxes')).data;
  const boxRow = boxesNow.find((b) => b.code === boxCode);
  check('电箱状态为 OCCUPIED', boxRow.status === 'OCCUPIED');

  const appId = r.find((x) => x.status === 201).data.id;

  /* ---------- 验收开通 ---------- */
  console.log('\n[2] 电工验收起始读数后才能供电');
  const rejected = await api(`/applications/${appId}/readings`, {
    method: 'POST',
    body: JSON.stringify({ value: 99 }),
  });
  check('未验收（PENDING）时录数被拒绝', rejected.status === 409, `got ${rejected.status}`);

  const act = await api(`/applications/${appId}/activate`, {
    method: 'POST',
    body: JSON.stringify({
      meterCode: `M-${stamp}-1`,
      initialValue: 100,
      recordedAt: '2026-01-15T08:00:00.000Z',
      electrician: '验证电工',
    }),
  });
  check('验收成功并进入 ACTIVE', act.status === 201 && act.data.status === 'ACTIVE');

  /* ---------- 检查 2：停用后、拆线前不能再分配 ---------- */
  console.log('\n[3] 停用未拆线，电箱仍不可分配');
  // 先录几笔跨月读数
  await api(`/applications/${appId}/readings`, {
    method: 'POST',
    body: JSON.stringify({ value: 600, recordedAt: '2026-01-31T20:00:00.000Z' }),
  });

  /* ---------- 检查 3：换表接续 ---------- */
  console.log('\n[4] 中途换表：旧表末值 + 新表初值，分段接续');
  const chg = await api(`/applications/${appId}/change-meter`, {
    method: 'POST',
    body: JSON.stringify({
      oldFinalValue: 800,
      newMeterCode: `M-${stamp}-2`,
      newInitialValue: 0,
      changedAt: '2026-02-10T12:00:00.000Z',
    }),
  });
  check('换表成功', chg.status === 201);
  const detailAfterChange = (await api(`/applications/${appId}`)).data;
  check('当前电表切换为新表', detailAfterChange.currentMeter.code === `M-${stamp}-2`);

  // 新表继续走（跨 2 月）
  await api(`/applications/${appId}/readings`, {
    method: 'POST',
    body: JSON.stringify({ value: 300, recordedAt: '2026-02-28T20:00:00.000Z' }),
  });
  await api(`/applications/${appId}/readings`, {
    method: 'POST',
    body: JSON.stringify({ value: 500, recordedAt: '2026-03-05T20:00:00.000Z' }),
  });

  /* ---------- 检查：异常跃升 + 倒退进入复核 ---------- */
  console.log('\n[5] 异常读数（倒退/跃升）进入复核，不直接计费');
  const surge = await api(`/applications/${appId}/readings`, {
    method: 'POST',
    body: JSON.stringify({ value: 99999, recordedAt: '2026-03-06T20:00:00.000Z' }),
  });
  check('异常跃升被识别', surge.status === 201 && surge.data.anomaly, surge.data.anomaly ?? '');
  const back = await api(`/applications/${appId}/readings`, {
    method: 'POST',
    body: JSON.stringify({ value: 100, recordedAt: '2026-03-07T20:00:00.000Z' }),
  });
  check('读数倒退被识别', back.status === 201 && back.data.anomaly, back.data.anomaly ?? '');

  // 用正确的末次读数停用（相对 500 正常）
  const stop = await api(`/applications/${appId}/stop`, {
    method: 'POST',
    body: JSON.stringify({ finalValue: 700, recordedAt: '2026-03-10T18:00:00.000Z' }),
  });
  check('停用成功，状态 STOPPED', stop.status === 201 && stop.data.status === 'STOPPED');

  // 此时仍有两笔待复核读数（99999 跃升、100 倒退）
  let detail = (await api(`/applications/${appId}`)).data;
  const pendingCount = detail.readings.filter((x) => x.status === 'PENDING_REVIEW').length;
  check('账单为 PENDING_REVIEW（暂挂不计费）', detail.billing.status === 'PENDING_REVIEW');
  check('待复核读数共 2 笔', pendingCount === 2, `实际 ${pendingCount}`);

  // 期望分段：
  //   旧表 100 -> 600 (1月) ; 600 -> 800 (2/10) = 旧表合计 700
  //   新表 0 -> 300 (2月) -> 500 -> 700 (3/10)，但 500->99999 与 99999->100 段含待复核 -> 挂起
  // 修正预期：含待复核读数的段挂起；其余段计费
  const billedSegs = detail.billingParsed.segments.filter((s) => s.billed);
  const blockedSegs = detail.billingParsed.segments.filter((s) => !s.billed);
  check('存在被挂起的分段（含异常读数）', blockedSegs.length >= 1, JSON.stringify(blockedSegs));
  const billedUsage = billedSegs.reduce((s, x) => s + x.usage, 0);
  // 旧表 100→800 = 700；新表 0→300 = 300；300→500=200 正常段；500→99999、99999→100 挂起；100→700 倒退段挂起
  check('计费分段用量只含正常段', billedUsage === 1200, `billedUsage=${billedUsage}`);

  /* 复核：99999 修正为 550（跃升录错），100 那笔确认为无效——按业务修正为 600 */
  const pendingReadings = detail.readings.filter((x) => x.status === 'PENDING_REVIEW');
  const r1 = pendingReadings.find((x) => x.value === 99999);
  const r2 = pendingReadings.find((x) => x.value === 100);
  await api(`/applications/${appId}/readings/${r1.id}/review`, {
    method: 'POST',
    body: JSON.stringify({ action: 'CORRECT', correctedValue: 550, reviewer: '复核员' }),
  });
  await api(`/applications/${appId}/readings/${r2.id}/review`, {
    method: 'POST',
    body: JSON.stringify({ action: 'CORRECT', correctedValue: 600, reviewer: '复核员' }),
  });
  detail = (await api(`/applications/${appId}`)).data;
  check('复核后账单转为 FINAL', detail.billing.status === 'FINAL', detail.billing.status);

  /* ---------- 检查 3 复核后：换表接续总用量 ---------- */
  // 最终读数链：
  //   旧表 100 → 600 → 800(末值)            用量 700
  //   新表   0 → 300 → 500 → 550 → 600 → 700(末次) 用量 700
  //   合计 1400
  check('换表接续后总用量 = 1400 kWh', detail.billing.totalUsage === 1400, `got ${detail.billing.totalUsage}`);
  check(
    '账单金额 = 1400 × 1.2 = 1680 元',
    Math.abs(detail.billing.totalAmount - 1680) < 0.01,
    `got ${detail.billing.totalAmount}`,
  );

  /* ---------- 检查 4：跨月分摊 ---------- */
  console.log('\n[6] 跨月结算：月度明细之和等于总用量');
  const monthly = detail.billingParsed.monthly;
  const monthSum = monthly.reduce((s, m) => s + m.usage, 0);
  check('覆盖 2026-01 / 02 / 03 三个月', monthly.map((m) => m.month).join(',') === '2026-01,2026-02,2026-03', monthly.map((m) => m.month).join(','));
  check('月度用量之和 = 总用量 1400', Math.abs(monthSum - 1400) < 0.01, `monthSum=${monthSum.toFixed(2)}`);
  check('1 月有用量（旧表 100→600）', (monthly.find((m) => m.month === '2026-01')?.usage ?? 0) > 0);
  check('3 月有用量（末次在 3/10）', (monthly.find((m) => m.month === '2026-03')?.usage ?? 0) > 0);

  /* ---------- 拆线前不能再分配 ---------- */
  console.log('\n[7] 停用未拆线，新班组仍无法申请该电箱');
  const retry = await apply(`班组D-${stamp}`, '停用后抢箱');
  check('拆线前再申请被 409 拒绝', retry.status === 409, `got ${retry.status}`);
  check('拒绝信息提示待拆线', /拆线/.test(retry.data.message), retry.data.message);

  // 未拆线状态下不允许重复停用类的操作、释放按钮仅 STOPPED 可用
  const releaseAgain = await api(`/applications/${appId}/release`, { method: 'POST', body: '{}' });
  check('拆线释放成功', releaseAgain.status === 201 && releaseAgain.data.status === 'RELEASED');

  const boxesAfter = (await api('/boxes')).data.find((b) => b.code === boxCode);
  check('拆线后电箱回到 FREE', boxesAfter.status === 'FREE', boxesAfter.status);

  /* ---------- 拆线后可以重新分配 ---------- */
  console.log('\n[8] 拆线释放后可重新分配');
  const second = await apply(`班组E-${stamp}`, '第二周期用电');
  check('新班组申请成功', second.status === 201, `got ${second.status}`);
  // 清理：验收后立即停用再释放
  const app2 = second.data.id;
  await api(`/applications/${app2}/activate`, {
    method: 'POST',
    body: JSON.stringify({ meterCode: `M-${stamp}-3`, initialValue: 0 }),
  });
  await api(`/applications/${app2}/stop`, { method: 'POST', body: JSON.stringify({ finalValue: 10 }) });
  await api(`/applications/${app2}/release`, { method: 'POST', body: '{}' });

  console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('验证脚本异常：', e);
  process.exit(1);
});
