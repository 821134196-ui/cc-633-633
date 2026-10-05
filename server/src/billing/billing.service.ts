import { Injectable } from '@nestjs/common';

/**
 * 用量结算核心：
 * - 读数链按 seq 排序，换表处由 MeterChange 把两段衔接（两段差值之和 = 实际用量）
 * - 异常读数（倒退 / 跃升）状态为 PENDING_REVIEW，不参与计费
 * - 跨月：每段差值按段内每日用量均摊到自然月
 */

export interface ChainReading {
  seq: number;
  meterId: string;
  meterCode: string;
  kind: string;
  value: number;
  recordedAt: string;
  status: string;
  anomalyReason?: string | null;
}

export interface UsageSegment {
  meterCode: string;
  fromReading: string; // kind / 时间
  fromValue: number;
  toValue: number;
  fromTime: string;
  toTime: string;
  usage: number;
  billed: boolean; // false = 段内含待复核读数，不计费
}

export interface MonthlyUsage {
  month: string; // YYYY-MM
  usage: number;
  amount: number;
  days: number;
}

export interface BillingResult {
  status: 'FINAL' | 'PENDING_REVIEW';
  totalUsage: number;
  totalAmount: number;
  unitPrice: number;
  segments: UsageSegment[];
  monthly: MonthlyUsage[];
  chain: ChainReading[];
  pendingReviews: ChainReading[];
}

// 异常跃升阈值：环比增量超过最近一次用量 5 倍且绝对值 > 1000 kWh
const SURGE_RATIO = 5;
const SURGE_MIN = 1000;

@Injectable()
export class BillingService {
  /** 检测新读数相对上一笔是否异常；返回 null 表示正常 */
  detectAnomaly(newValue: number, prev: { value: number; usageFromItsPrev?: number } | null): string | null {
    if (!prev) return null;
    if (newValue < prev.value) {
      return `读数倒退：本次 ${newValue} < 上一笔 ${prev.value}`;
    }
    const delta = newValue - prev.value;
    if (prev.usageFromItsPrev != null && prev.usageFromItsPrev > 0) {
      if (delta > SURGE_MIN && delta > prev.usageFromItsPrev * SURGE_RATIO) {
        return `异常跃升：本次增量 ${delta} kWh，远超上笔增量 ${prev.usageFromItsPrev} kWh`;
      }
    }
    return null;
  }

  /**
   * 计算账单。
   * readings: 已按 seq 升序
   * changes: 换表记录（oldMeterId/newMeterId）
   * unitPrice: 适用电价
   */
  calculate(params: {
    readings: any[];
    changes: any[];
    unitPrice: number;
  }): BillingResult {
    const { readings, changes, unitPrice } = params;

    const chain: ChainReading[] = readings.map((r) => ({
      seq: r.seq,
      meterId: r.meterId,
      meterCode: r.meter?.code ?? r.meterCode ?? r.meterId,
      kind: r.kind,
      value: r.value,
      recordedAt: new Date(r.recordedAt).toISOString(),
      status: r.status,
      anomalyReason: r.anomalyReason,
    }));

    // 分段：同一电表内每一对相邻读数形成一个用量段；
    // 换表边界（旧表 OLD_FINAL -> 新表 NEW_INITIAL，meterId 不同）不成段，两段各自独立、接续求和。
    const ordered = [...readings].sort((a, b) => a.seq - b.seq);
    const segments: UsageSegment[] = [];
    const pending: ChainReading[] = chain.filter((r) => r.status === 'PENDING_REVIEW');

    const pushSegment = (from: any, to: any) => {
      const usage = +(to.value - from.value).toFixed(3);
      // 段两端或段内任何一笔读数处于待复核，则该段挂起不计费；负差值（倒退）同样挂起
      const meterBlocked = pending.some(
        (p) =>
          p.meterId === to.meterId &&
          new Date(p.recordedAt).getTime() >= new Date(from.recordedAt).getTime() &&
          new Date(p.recordedAt).getTime() <= new Date(to.recordedAt).getTime(),
      );
      segments.push({
        meterCode: to.meter?.code ?? to.meterCode ?? to.meterId,
        fromReading: `${from.kind}@${from.seq}`,
        fromValue: from.value,
        toValue: to.value,
        fromTime: new Date(from.recordedAt).toISOString(),
        toTime: new Date(to.recordedAt).toISOString(),
        usage,
        billed: !meterBlocked && usage >= 0,
      });
    };

    for (let i = 1; i < ordered.length; i++) {
      const from = ordered[i - 1];
      const to = ordered[i];
      if (from.meterId !== to.meterId) {
        // 换表边界：跨表差值无意义，旧表段已在 OLD_FINAL 收尾、新表段从 NEW_INITIAL 起算
        continue;
      }
      pushSegment(from, to);
    }
    const hasFinal = ordered.some((r) => r.kind === 'FINAL');

    // 只对 billed 段计费；含待复核读数的段挂起
    const billedSegments = hasFinal ? segments.filter((s) => s.billed) : [];
    const blockedSegments = hasFinal ? segments.filter((s) => !s.billed) : [];

    // 跨月分摊：段内按天均摊
    const monthMap = new Map<string, { usage: number; days: Set<string> }>();
    for (const seg of billedSegments) {
      for (const [month, usage, day] of this.allocateByDay(seg)) {
        const e = monthMap.get(month) ?? { usage: 0, days: new Set<string>() };
        e.usage += usage;
        e.days.add(day);
        monthMap.set(month, e);
      }
    }
    const monthly: MonthlyUsage[] = [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, e]) => ({
        month,
        days: e.days.size,
        usage: +e.usage.toFixed(3),
        amount: +(e.usage * unitPrice).toFixed(2),
      }));

    const totalUsage = +billedSegments.reduce((s, x) => s + x.usage, 0).toFixed(3);
    const status: BillingResult['status'] =
      hasFinal && (pending.length > 0 || blockedSegments.length > 0)
        ? 'PENDING_REVIEW'
        : 'FINAL';

    return {
      status: hasFinal ? status : 'PENDING_REVIEW',
      totalUsage: hasFinal ? totalUsage : 0,
      totalAmount: +(totalUsage * unitPrice).toFixed(2),
      unitPrice,
      segments,
      monthly,
      chain,
      pendingReviews: pending,
    };
  }

  /** 段差值按天均摊，产出 [YYYY-MM, usage, YYYY-MM-DD][] */
  private allocateByDay(seg: UsageSegment): [string, number, string][] {
    const t0 = new Date(seg.fromTime).getTime();
    const t1 = new Date(seg.toTime).getTime();
    if (t1 <= t0) {
      const d = new Date(seg.fromTime);
      const month = monthKey(d);
      return [[month, seg.usage, dayKey(d)]];
    }
    const days: string[] = [];
    const cur = new Date(t0);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(t1);
    end.setHours(0, 0, 0, 0);
    while (cur.getTime() <= end.getTime()) {
      days.push(dayKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
    // 首尾按 24h 占比切分，简化：整段均摊到覆盖的每一天
    const per = seg.usage / days.length;
    return days.map((d) => [d.slice(0, 7), per, d]);
  }
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function dayKey(d: Date) {
  return `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
}
