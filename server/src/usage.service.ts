import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface UsageSegment {
  meterId: number;
  meterCode: string;
  start: number;
  end: number;
  usage: number;
  installedAt: string;
  removedAt: string | null;
}

export interface UsageResult {
  totalUsage: number;
  segments: UsageSegment[];
  monthly: { month: string; usage: number }[];
  readings: {
    id: number;
    meterCode: string;
    value: number;
    kind: string;
    recordedBy: string;
    recordedAt: string;
  }[];
}

/**
 * 用量计算：
 * - 按电表分段：每块表 用量 = 末值 - 初值，中途换表时各段累加，保证接续正确；
 * - 逐月分摊：同一表上相邻两笔有效读数之差，计入后一笔读数所在月份，
 *   跨月用电的完整读数链保留在 readings 中，结算可逐笔核对。
 * 只有 CONFIRMED 状态的读数参与计算；待复核/已驳回的不计费。
 */
@Injectable()
export class UsageService {
  constructor(private prisma: PrismaService) {}

  async compute(applicationId: number, db: any = this.prisma): Promise<UsageResult> {
    const meters = await db.meter.findMany({
      where: { applicationId },
      orderBy: [{ installedAt: 'asc' }, { id: 'asc' }],
      include: {
        readings: {
          where: { status: 'CONFIRMED' },
          orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        },
      },
    });

    const segments: UsageSegment[] = [];
    const monthlyMap = new Map<string, number>();
    const readings: UsageResult['readings'] = [];

    for (const m of meters) {
      const chain = m.readings;
      const lastValue = chain.length ? chain[chain.length - 1].value : m.initialReading;
      const end = m.finalReading ?? lastValue;
      segments.push({
        meterId: m.id,
        meterCode: m.code,
        start: m.initialReading,
        end,
        usage: round2(Math.max(0, end - m.initialReading)),
        installedAt: m.installedAt.toISOString(),
        removedAt: m.removedAt ? m.removedAt.toISOString() : null,
      });

      // 相邻有效读数之差计入后一笔所在月份（链首即 INITIAL / SWAP_NEW_INITIAL）
      for (let i = 1; i < chain.length; i++) {
        const delta = chain[i].value - chain[i - 1].value;
        if (delta <= 0) continue;
        const month = chain[i].recordedAt.toISOString().slice(0, 7);
        monthlyMap.set(month, round2((monthlyMap.get(month) ?? 0) + delta));
      }

      for (const r of chain) {
        readings.push({
          id: r.id,
          meterCode: m.code,
          value: r.value,
          kind: r.kind,
          recordedBy: r.recordedBy,
          recordedAt: r.recordedAt.toISOString(),
        });
      }
    }

    readings.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id - b.id);

    return {
      totalUsage: round2(segments.reduce((sum, s) => sum + s.usage, 0)),
      segments,
      monthly: [...monthlyMap.entries()]
        .map(([month, usage]) => ({ month, usage }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      readings,
    };
  }
}
