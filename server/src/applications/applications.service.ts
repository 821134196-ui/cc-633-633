import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { MeterSimService } from '../meter/meter-sim.service';
import { withLock } from '../common/locks';

export const APP_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  STOPPED: 'STOPPED',
  RELEASED: 'RELEASED',
  REJECTED: 'REJECTED',
} as const;

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger('Applications');

  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private meterSim: MeterSimService,
  ) {}

  private async currentTariff(at: Date): Promise<number> {
    const t = await this.prisma.tariffRate.findFirst({
      where: { effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return t?.pricePerKwh ?? 1.0;
  }

  // ---------- 班组：提交申请（原子占用电箱） ----------
  async apply(dto: {
    teamName: string;
    contact?: string;
    boxCode: string;
    purpose: string;
    plannedStart: string;
    plannedEnd?: string;
  }) {
    const box = await this.prisma.box.findUnique({ where: { code: dto.boxCode } });
    if (!box) throw new NotFoundException(`电箱 ${dto.boxCode} 不存在`);

    return withLock(`box:${box.id}`, async () => {
      // 条件 UPDATE 是并发正确性的关键：只在 FREE 时成功，数据库层面保证只有一组胜出
      const claimed = await this.prisma.box.updateMany({
        where: { id: box.id, status: 'FREE' },
        data: { status: 'OCCUPIED' },
      });
      if (claimed.count === 0) {
        const current = await this.prisma.application.findFirst({
          where: { boxId: box.id },
          orderBy: { createdAt: 'desc' },
          include: { team: true },
        });
        throw new ConflictException(
          `电箱 ${dto.boxCode} 已被占用（申请 ${current?.code} / 班组 ${current?.team?.name}，` +
            `${current?.status === 'STOPPED' ? '已停用待拆线，拆线前不可再分配' : '使用中'}）`,
        );
      }

      const team = await this.prisma.team.upsert({
        where: { name: dto.teamName },
        update: { contact: dto.contact ?? null },
        create: { name: dto.teamName, contact: dto.contact },
      });

      const app = await this.prisma.application.create({
        data: {
          code: `YD-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`,
          teamId: team.id,
          boxId: box.id,
          purpose: dto.purpose,
          plannedStart: new Date(dto.plannedStart),
          plannedEnd: dto.plannedEnd ? new Date(dto.plannedEnd) : null,
          status: APP_STATUS.PENDING,
        },
      });
      await this.prisma.box.update({
        where: { id: box.id },
        data: { currentApplicationId: app.id },
      });
      this.logger.log(`班组 ${dto.teamName} 申请电箱 ${dto.boxCode} -> ${app.code}（PENDING）`);
      return this.getDetail(app.id);
    });
  }

  // ---------- 电工：验收接线 + 确认起始读数后开通 ----------
  async activate(
    id: string,
    dto: { meterCode: string; initialValue: number; recordedAt?: string; electrician?: string; safetyNote?: string },
  ) {
    return withLock(`app:${id}`, async () => {
      const app = await this.prisma.application.findUnique({ where: { id } });
      if (!app) throw new NotFoundException('申请不存在');
      if (app.status !== APP_STATUS.PENDING) {
        throw new ConflictException(`申请状态为 ${app.status}，不能验收开通`);
      }
      const verify = await this.meterSim.verifyReading(dto.meterCode, dto.initialValue);
      if (!verify.ok) throw new BadRequestException(verify.message);

      const meter = await this.prisma.meter.upsert({
        where: { code: dto.meterCode },
        update: { status: 'INSTALLED', applicationId: app.id, removedAt: null },
        create: { code: dto.meterCode, status: 'INSTALLED', applicationId: app.id },
      });

      const seq = 1;
      await this.prisma.reading.create({
        data: {
          applicationId: app.id,
          meterId: meter.id,
          seq,
          kind: 'INITIAL',
          value: dto.initialValue,
          recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
          status: 'OK',
          note: dto.safetyNote ?? `电工 ${dto.electrician ?? ''} 验收接线安全，起始读数`,
        },
      });
      const updated = await this.prisma.application.update({
        where: { id: app.id },
        data: { status: APP_STATUS.ACTIVE, activatedAt: new Date(), currentMeterId: meter.id },
      });
      this.logger.log(`${app.code} 验收通过，${dto.meterCode} 起读 ${dto.initialValue}，已供电`);
      return this.getDetail(updated.id);
    });
  }

  /** 电工拒绝验收：释放电箱 */
  async reject(id: string, dto: { reason: string }) {
    const app = await this.prisma.application.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('申请不存在');
    if (app.status !== APP_STATUS.PENDING)
      throw new ConflictException(`申请状态为 ${app.status}，不能拒绝`);
    await this.prisma.application.update({
      where: { id },
      data: { status: APP_STATUS.REJECTED, rejectReason: dto.reason },
    });
    await this.prisma.box.update({
      where: { id: app.boxId },
      data: { status: 'FREE', currentApplicationId: null },
    });
    return this.getDetail(id);
  }

  // ---------- 手机录数（中途）：展示上一笔，倒退/跃升进入复核 ----------
  async recordReading(id: string, dto: { value: number; recordedAt?: string; note?: string }) {
    return withLock(`app:${id}`, async () => {
      const app = await this.prisma.application.findUnique({ where: { id } });
      if (!app) throw new NotFoundException('申请不存在');
      if (app.status !== APP_STATUS.ACTIVE)
        throw new ConflictException(`申请状态为 ${app.status}，不能录数`);

      const meter = await this.prisma.meter.findUnique({ where: { id: app.currentMeterId! } });
      if (!meter) throw new ConflictException('当前无在用电表');

      const verify = await this.meterSim.verifyReading(meter.code, dto.value);
      if (!verify.ok) throw new BadRequestException(verify.message);

      const prev = await this.prisma.reading.findFirst({
        where: { applicationId: id },
        orderBy: { seq: 'desc' },
      });
      // 上一笔相对其前一笔的增量（用于异常跃升比较）
      let prevDelta: number | undefined;
      if (prev) {
        const prevPrev = await this.prisma.reading.findFirst({
          where: { applicationId: id, seq: { lt: prev.seq } },
          orderBy: { seq: 'desc' },
        });
        if (prevPrev && prevPrev.meterId === prev.meterId) {
          prevDelta = prev.value - prevPrev.value;
        }
      }
      const anomaly = this.billing.detectAnomaly(dto.value, prev
        ? { value: prev.value, usageFromItsPrev: prevDelta }
        : null);

      const seq = (prev?.seq ?? 0) + 1;
      const reading = await this.prisma.reading.create({
        data: {
          applicationId: id,
          meterId: meter.id,
          seq,
          kind: 'INTERIM',
          value: dto.value,
          recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
          status: anomaly ? 'PENDING_REVIEW' : 'OK',
          anomalyReason: anomaly,
          previousReadingId: prev?.id,
          note: dto.note,
        },
      });
      if (anomaly) {
        this.logger.warn(`${app.code} 录数 ${dto.value} 触发复核：${anomaly}`);
      }
      return { reading, previous: prev, anomaly };
    });
  }

  // ---------- 复核：确认（可修正）或驳回 ----------
  async reviewReading(id: string, readingId: string, dto: {
    action: 'CONFIRM' | 'CORRECT';
    correctedValue?: number;
    reviewer?: string;
    note?: string;
  }) {
    const reading = await this.prisma.reading.findFirst({
      where: { id: readingId, applicationId: id },
    });
    if (!reading) throw new NotFoundException('读数不存在');
    if (reading.status !== 'PENDING_REVIEW')
      throw new ConflictException('该读数不在待复核状态');

    if (dto.action === 'CORRECT') {
      if (dto.correctedValue == null) throw new BadRequestException('修正读数必须提供 correctedValue');
      const verify = await this.meterSim.verifyReading(reading.meterId, dto.correctedValue);
      if (!verify.ok) throw new BadRequestException(verify.message);
      await this.prisma.reading.update({
        where: { id: reading.id },
        data: {
          value: dto.correctedValue,
          status: 'CONFIRMED',
          reviewer: dto.reviewer,
          reviewedAt: new Date(),
          note: reading.note ? `${reading.note}｜复核修正：${dto.note ?? ''}` : `复核修正：${dto.note ?? ''}`,
          anomalyReason: reading.anomalyReason,
        },
      });
    } else {
      await this.prisma.reading.update({
        where: { id: reading.id },
        data: { status: 'CONFIRMED', reviewer: dto.reviewer, reviewedAt: new Date() },
      });
    }
    // 若已停用，复核后重新计算账单（可能从 PENDING_REVIEW 变为 FINAL 并触发收费）
    await this.regenerateBilling(id);
    return this.getDetail(id);
  }

  // ---------- 中途换表：旧表末值 + 新表初值，接续计算 ----------
  async changeMeter(id: string, dto: {
    oldFinalValue: number;
    newMeterCode: string;
    newInitialValue: number;
    changedAt?: string;
    note?: string;
  }) {
    return withLock(`app:${id}`, async () => {
      const app = await this.prisma.application.findUnique({ where: { id } });
      if (!app) throw new NotFoundException('申请不存在');
      if (app.status !== APP_STATUS.ACTIVE)
        throw new ConflictException(`申请状态为 ${app.status}，不能换表`);

      const oldMeter = await this.prisma.meter.findUnique({ where: { id: app.currentMeterId! } });
      if (!oldMeter) throw new ConflictException('无在用电表');

      // 旧表末值也要做倒退校验（相对旧表上一笔）
      const prev = await this.prisma.reading.findFirst({
        where: { applicationId: id },
        orderBy: { seq: 'desc' },
      });
      const anomaly = prev && prev.meterId === oldMeter.id
        ? this.billing.detectAnomaly(dto.oldFinalValue, { value: prev.value })
        : null;
      if (anomaly) {
        throw new BadRequestException(`旧表末值${anomaly}，请先现场复核后再换表`);
      }

      const existsNew = await this.prisma.meter.findUnique({ where: { code: dto.newMeterCode } });
      if (existsNew && existsNew.status === 'INSTALLED' && existsNew.applicationId !== id) {
        throw new ConflictException(`新表 ${dto.newMeterCode} 已在别处安装`);
      }
      const vOld = await this.meterSim.verifyReading(oldMeter.code, dto.oldFinalValue);
      const vNew = await this.meterSim.verifyReading(dto.newMeterCode, dto.newInitialValue);
      if (!vOld.ok) throw new BadRequestException(vOld.message);
      if (!vNew.ok) throw new BadRequestException(vNew.message);

      const changedAt = dto.changedAt ? new Date(dto.changedAt) : new Date();
      const lastSeq = prev?.seq ?? 0;

      const newMeter = await this.prisma.meter.upsert({
        where: { code: dto.newMeterCode },
        update: { status: 'INSTALLED', applicationId: app.id, removedAt: null },
        create: { code: dto.newMeterCode, status: 'INSTALLED', applicationId: app.id },
      });

      const oldFinal = await this.prisma.reading.create({
        data: {
          applicationId: id,
          meterId: oldMeter.id,
          seq: lastSeq + 1,
          kind: 'OLD_FINAL',
          value: dto.oldFinalValue,
          recordedAt: changedAt,
          status: 'OK',
          note: `换表：旧表 ${oldMeter.code} 末值`,
        },
      });
      const newInitial = await this.prisma.reading.create({
        data: {
          applicationId: id,
          meterId: newMeter.id,
          seq: lastSeq + 2,
          kind: 'NEW_INITIAL',
          value: dto.newInitialValue,
          recordedAt: changedAt,
          status: 'OK',
          note: `换表：新表 ${newMeter.code} 初值`,
        },
      });

      await this.prisma.meter.update({
        where: { id: oldMeter.id },
        data: { status: 'REMOVED', removedAt: changedAt },
      });
      await this.prisma.meterChange.create({
        data: {
          applicationId: id,
          oldMeterId: oldMeter.id,
          newMeterId: newMeter.id,
          oldFinalReadingId: oldFinal.id,
          newInitialReadingId: newInitial.id,
          changedAt,
          note: dto.note,
        },
      });
      await this.prisma.application.update({
        where: { id },
        data: { currentMeterId: newMeter.id },
      });
      this.logger.log(
        `${app.code} 换表：${oldMeter.code} 末值 ${dto.oldFinalValue} -> ${newMeter.code} 初值 ${dto.newInitialValue}`,
      );
      return this.getDetail(id);
    });
  }

  // ---------- 停用：核对末次读数 + 生成账单 ----------
  async stop(id: string, dto: { finalValue: number; recordedAt?: string; note?: string }) {
    return withLock(`app:${id}`, async () => {
      const app = await this.prisma.application.findUnique({ where: { id } });
      if (!app) throw new NotFoundException('申请不存在');
      if (app.status !== APP_STATUS.ACTIVE)
        throw new ConflictException(`申请状态为 ${app.status}，不能停用`);

      const meter = await this.prisma.meter.findUnique({ where: { id: app.currentMeterId! } });
      const prev = await this.prisma.reading.findFirst({
        where: { applicationId: id },
        orderBy: { seq: 'desc' },
      });
      const anomaly = this.billing.detectAnomaly(dto.finalValue, prev
        ? { value: prev.value }
        : null);

      const verify = await this.meterSim.verifyReading(meter!.code, dto.finalValue);
      if (!verify.ok) throw new BadRequestException(verify.message);

      const seq = (prev?.seq ?? 0) + 1;
      const finalReading = await this.prisma.reading.create({
        data: {
          applicationId: id,
          meterId: meter!.id,
          seq,
          kind: 'FINAL',
          value: dto.finalValue,
          recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
          status: anomaly ? 'PENDING_REVIEW' : 'OK',
          anomalyReason: anomaly,
          previousReadingId: prev?.id,
          note: dto.note ?? '停用末次读数',
        },
      });

      const stoppedAt = finalReading.recordedAt;
      await this.prisma.application.update({
        where: { id },
        data: { status: APP_STATUS.STOPPED, stoppedAt },
      });
      // 注意：电箱仍为 OCCUPIED，必须电工拆线后才 FREE
      await this.regenerateBilling(id);
      this.logger.log(`${app.code} 已停用（末次 ${dto.finalValue}${anomaly ? '，待复核' : ''}），等待拆线`);
      return this.getDetail(id);
    });
  }

  /** 复核处理后重新计算账单 */
  async regenerateBilling(id: string) {
    const app = await this.prisma.application.findUnique({ where: { id } });
    if (!app || (app.status !== APP_STATUS.STOPPED && app.status !== APP_STATUS.RELEASED)) {
      return null;
    }
    const [readings, changes] = await Promise.all([
      this.prisma.reading.findMany({
        where: { applicationId: id },
        orderBy: { seq: 'asc' },
        include: { meter: true },
      }),
      this.prisma.meterChange.findMany({ where: { applicationId: id } }),
    ]);
    const unitPrice = await this.currentTariff(app.stoppedAt ?? new Date());
    const result = this.billing.calculate({ readings, changes, unitPrice });

    // 首次变成 FINAL 时调用一次模拟收费；此前待复核阶段只出暂挂账单
    const existing = await this.prisma.billing.findUnique({ where: { applicationId: id } });
    let amount = result.totalAmount;
    if (result.status === 'FINAL' && existing?.status !== 'FINAL') {
      const charge = await this.meterSim.charge({
        applicationCode: app.code,
        usage: result.totalUsage,
        unitPrice,
      });
      amount = charge.amount;
    }

    const data = {
      status: result.status,
      totalUsage: result.totalUsage,
      totalAmount: amount,
      segmentsText: JSON.stringify(result.segments),
      monthlyText: JSON.stringify(result.monthly),
      chainText: JSON.stringify(result.chain),
      updatedAt: new Date(),
    };
    const billing = await this.prisma.billing.upsert({
      where: { applicationId: id },
      update: data,
      create: { applicationId: id, ...data },
    });
    return billing;
  }

  // ---------- 电工拆线：电箱才真正释放 ----------
  async release(id: string, dto: { electrician?: string; note?: string }) {
    return withLock(`app:${id}`, async () => {
      const app = await this.prisma.application.findUnique({ where: { id } });
      if (!app) throw new NotFoundException('申请不存在');
      if (app.status !== APP_STATUS.STOPPED)
        throw new ConflictException(`申请状态为 ${app.status}：仅"已停用待拆线"可以拆线释放`);
      await this.prisma.application.update({
        where: { id },
        data: { status: APP_STATUS.RELEASED, releasedAt: new Date() },
      });
      if (app.currentMeterId) {
        await this.prisma.meter.updateMany({
          where: { id: app.currentMeterId, status: 'INSTALLED' },
          data: { status: 'REMOVED', removedAt: new Date() },
        });
      }
      // 条件更新：确保不会误清别的申请的占用
      await this.prisma.box.updateMany({
        where: { id: app.boxId, currentApplicationId: app.id },
        data: { status: 'FREE', currentApplicationId: null },
      });
      this.logger.log(`${app.code} 拆线完成，电箱已释放，可以重新分配`);
      return this.getDetail(id);
    });
  }

  // ---------- 查询 ----------
  async list() {
    return this.prisma.application.findMany({
      orderBy: { createdAt: 'desc' },
      include: { team: true, box: true, billing: true },
    });
  }

  async getDetail(id: string) {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: {
        team: true,
        box: true,
        readings: { orderBy: { seq: 'asc' }, include: { meter: true } },
        meterChanges: true,
        billing: true,
        currentMeter: true,
      },
    });
    if (!app) throw new NotFoundException('申请不存在');
    const unitPrice = await this.currentTariff(app.stoppedAt ?? new Date());
    const preview = this.billing.calculate({
      readings: app.readings,
      changes: app.meterChanges,
      unitPrice,
    });
    return {
      ...app,
      billingParsed: app.billing
        ? {
            ...app.billing,
            unitPrice: preview.unitPrice,
            segments: JSON.parse(app.billing.segmentsText),
            monthly: JSON.parse(app.billing.monthlyText),
            chain: JSON.parse(app.billing.chainText),
          }
        : null,
      preview,
    };
  }
}
