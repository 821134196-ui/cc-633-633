import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UsageService } from './usage.service';
import { PricingService } from './pricing.service';
import {
  ApproveDto,
  CreateApplicationDto,
  DisconnectDto,
  FinalizeDto,
  RejectDto,
  SwapMeterDto,
} from './dto';

const FULL_INCLUDE = {
  team: true,
  box: true,
  occupancy: true,
  meters: { orderBy: { id: 'asc' as const } },
  readings: { orderBy: [{ recordedAt: 'asc' as const }, { id: 'asc' as const }] },
  bill: true,
};

@Injectable()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
    private usage: UsageService,
    private pricing: PricingService,
  ) {}

  private jumpThreshold() {
    return Number(process.env.JUMP_THRESHOLD) || 500;
  }

  async getOrThrow(id: number) {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: FULL_INCLUDE,
    });
    if (!app) throw new NotFoundException(`申请 #${id} 不存在`);
    return app;
  }

  list(status?: string, teamId?: number) {
    return this.prisma.application.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(teamId ? { teamId } : {}),
      },
      include: FULL_INCLUDE,
      orderBy: { id: 'desc' },
    });
  }

  /**
   * 班组提交申请。提交即占用电箱（BoxOccupancy.boxId 唯一约束），
   * 并发申请同一电箱时只有一单能插入成功，其余收到 409。
   */
  async create(dto: CreateApplicationDto) {
    const team = await this.prisma.team.findUnique({ where: { id: dto.teamId } });
    if (!team) throw new NotFoundException('班组不存在');
    const box = await this.prisma.electricBox.findUnique({
      where: { id: dto.boxId },
      include: { occupancy: true },
    });
    if (!box) throw new NotFoundException('电箱不存在');
    if (new Date(dto.plannedEnd) <= new Date(dto.plannedStart)) {
      throw new BadRequestException('计划结束时间必须晚于开始时间');
    }
    if (box.occupancy) {
      throw new ConflictException(`电箱 ${box.code} 正被占用，暂不能申请`);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const app = await tx.application.create({
          data: {
            teamId: dto.teamId,
            boxId: dto.boxId,
            purpose: dto.purpose,
            plannedStart: new Date(dto.plannedStart),
            plannedEnd: new Date(dto.plannedEnd),
            status: 'PENDING',
          },
        });
        await tx.boxOccupancy.create({
          data: { boxId: dto.boxId, applicationId: app.id },
        });
        return tx.application.findUnique({ where: { id: app.id }, include: FULL_INCLUDE });
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(`电箱 ${box.code} 正被占用，暂不能申请`);
      }
      throw e;
    }
  }

  /** 电工验收接线安全并登记起始读数，通过后开通供电 */
  async approve(id: number, dto: ApproveDto) {
    const app = await this.getOrThrow(id);
    if (app.status !== 'PENDING') {
      throw new BadRequestException(`当前状态(${app.status})不可验收开通`);
    }
    if (!dto.wiringConfirmed) {
      throw new BadRequestException('接线安全未验收确认，不能开通供电');
    }
    const at = dto.at ? new Date(dto.at) : new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const meter = await tx.meter.create({
          data: {
            code: dto.meterCode,
            applicationId: id,
            initialReading: dto.initialReading,
            installedAt: at,
          },
        });
        await tx.reading.create({
          data: {
            meterId: meter.id,
            applicationId: id,
            value: dto.initialReading,
            kind: 'INITIAL',
            recordedBy: dto.electrician,
            recordedAt: at,
          },
        });
        return tx.application.update({
          where: { id },
          data: { status: 'ACTIVE' },
          include: FULL_INCLUDE,
        });
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException(`表编号 ${dto.meterCode} 已被使用`);
      throw e;
    }
  }

  /** 电工驳回申请，释放电箱 */
  async reject(id: number, dto: RejectDto) {
    const app = await this.getOrThrow(id);
    if (app.status !== 'PENDING') {
      throw new BadRequestException(`当前状态(${app.status})不可驳回`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.boxOccupancy.deleteMany({ where: { applicationId: id } });
      return tx.application.update({
        where: { id },
        data: { status: 'REJECTED' },
        include: FULL_INCLUDE,
      });
    });
  }

  /** 班组在验收前取消申请，释放电箱 */
  async cancel(id: number) {
    const app = await this.getOrThrow(id);
    if (app.status !== 'PENDING') {
      throw new BadRequestException(`当前状态(${app.status})不可取消`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.boxOccupancy.deleteMany({ where: { applicationId: id } });
      return tx.application.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: FULL_INCLUDE,
      });
    });
  }

  /** 班组申请停用，等待电工核对末次读数 */
  async requestStop(id: number) {
    const app = await this.getOrThrow(id);
    if (app.status !== 'ACTIVE') {
      throw new BadRequestException(`当前状态(${app.status})不可申请停用`);
    }
    return this.prisma.application.update({
      where: { id },
      data: { status: 'STOPPING' },
      include: FULL_INCLUDE,
    });
  }

  /**
   * 中途换表：记录旧表末值与新表初值，用量分段接续计算。
   * 旧表末值不得小于该表上一笔有效读数。
   */
  async swapMeter(id: number, dto: SwapMeterDto) {
    const app = await this.getOrThrow(id);
    if (app.status !== 'ACTIVE') {
      throw new BadRequestException(`当前状态(${app.status})不可换表`);
    }
    const oldMeter = app.meters.find((m) => m.status === 'ACTIVE');
    if (!oldMeter) throw new BadRequestException('未找到在用电表');

    const last = await this.lastConfirmedValue(oldMeter.id, oldMeter.initialReading);
    if (dto.oldFinal < last) {
      throw new BadRequestException(
        `旧表末值 ${dto.oldFinal} 小于上一笔有效读数 ${last}，请现场核对后再录`,
      );
    }
    const at = dto.at ? new Date(dto.at) : new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.reading.create({
          data: {
            meterId: oldMeter.id,
            applicationId: id,
            value: dto.oldFinal,
            kind: 'SWAP_OLD_FINAL',
            recordedBy: dto.electrician,
            recordedAt: at,
          },
        });
        await tx.meter.update({
          where: { id: oldMeter.id },
          data: { finalReading: dto.oldFinal, status: 'REPLACED', removedAt: at },
        });
        const meter = await tx.meter.create({
          data: {
            code: dto.newCode,
            applicationId: id,
            initialReading: dto.newInitial,
            installedAt: at,
          },
        });
        await tx.reading.create({
          data: {
            meterId: meter.id,
            applicationId: id,
            value: dto.newInitial,
            kind: 'SWAP_NEW_INITIAL',
            recordedBy: dto.electrician,
            recordedAt: at,
          },
        });
        return tx.application.findUnique({ where: { id }, include: FULL_INCLUDE });
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException(`表编号 ${dto.newCode} 已被使用`);
      throw e;
    }
  }

  /**
   * 停用核表：登记末次读数并生成账单。
   * 末次读数倒退或异常跃升时默认拒绝（409），电工现场确认后可带 confirmAbnormal 强制入账。
   * 账单生成后电箱仍处于占用状态，须拆线确认才释放。
   */
  async finalize(id: number, dto: FinalizeDto) {
    const app = await this.getOrThrow(id);
    if (app.status !== 'STOPPING') {
      throw new BadRequestException(`当前状态(${app.status})不可结算，请先申请停用`);
    }
    const meter = app.meters.find((m) => m.status === 'ACTIVE');
    if (!meter) throw new BadRequestException('未找到在用电表');

    const last = await this.lastConfirmedValue(meter.id, meter.initialReading);
    const delta = dto.value - last;
    const abnormal =
      delta < 0
        ? 'READING_REGRESSION'
        : delta > this.jumpThreshold()
          ? 'ABNORMAL_JUMP'
          : null;
    if (abnormal && !dto.confirmAbnormal) {
      throw new ConflictException({
        message: `末次读数异常（上一笔有效读数 ${last}，本次 ${dto.value}），需现场复核后确认`,
        reason: abnormal,
        lastReading: last,
      });
    }

    const at = dto.at ? new Date(dto.at) : new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.reading.create({
        data: {
          meterId: meter.id,
          applicationId: id,
          value: dto.value,
          kind: 'FINAL',
          recordedBy: dto.electrician,
          recordedAt: at,
          reviewNote: abnormal ? '末次读数异常，电工现场确认入账' : null,
        },
      });
      await tx.meter.update({
        where: { id: meter.id },
        data: { finalReading: dto.value, status: 'CLOSED', removedAt: at },
      });
      await tx.application.update({ where: { id }, data: { status: 'AWAIT_DISCONNECT' } });

      const usage = await this.usage.compute(id, tx);
      const quote = this.pricing.quote(usage.totalUsage);
      await tx.bill.create({
        data: {
          applicationId: id,
          totalUsage: usage.totalUsage,
          unitPrice: quote.unitPrice,
          totalAmount: quote.amount,
          detail: JSON.stringify({
            segments: usage.segments,
            monthly: usage.monthly,
            readings: usage.readings,
            abnormalFinalConfirmed: abnormal ? true : undefined,
          }),
        },
      });
      return tx.application.findUnique({ where: { id }, include: FULL_INCLUDE });
    });
  }

  /** 电工确认拆线，释放电箱。停用/结算本身不释放电箱。 */
  async disconnect(id: number, dto: DisconnectDto) {
    const app = await this.getOrThrow(id);
    if (app.status !== 'AWAIT_DISCONNECT') {
      throw new BadRequestException(`当前状态(${app.status})不可确认拆线`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.boxOccupancy.deleteMany({ where: { applicationId: id } });
      return tx.application.update({
        where: { id },
        data: { status: 'COMPLETED' },
        include: FULL_INCLUDE,
      });
    });
  }

  private async lastConfirmedValue(meterId: number, fallback: number): Promise<number> {
    const last = await this.prisma.reading.findFirst({
      where: { meterId, status: 'CONFIRMED' },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    });
    return last ? last.value : fallback;
  }
}
