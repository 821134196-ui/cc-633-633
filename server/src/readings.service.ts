import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CreateReadingDto, ReviewDto } from './dto';

@Injectable()
export class ReadingsService {
  constructor(private prisma: PrismaService) {}

  private jumpThreshold() {
    return Number(process.env.JUMP_THRESHOLD) || 500;
  }

  /** 当前在用电表的上一笔有效读数（手机录数页展示用） */
  async previous(applicationId: number) {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { meters: true },
    });
    if (!app) throw new NotFoundException(`申请 #${applicationId} 不存在`);
    const meter = app.meters.find((m) => m.status === 'ACTIVE');
    if (!meter) throw new BadRequestException('当前没有在用电表');

    const last = await this.prisma.reading.findFirst({
      where: { meterId: meter.id, status: 'CONFIRMED' },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    });
    return {
      applicationId,
      meterCode: meter.code,
      previous: last
        ? { value: last.value, recordedAt: last.recordedAt, kind: last.kind }
        : { value: meter.initialReading, recordedAt: meter.installedAt, kind: 'INITIAL' },
    };
  }

  /**
   * 手机录数：与上一笔有效读数比较，
   * 倒退或异常跃升（超过阈值）一律进入复核（PENDING_REVIEW），不参与计费。
   */
  async create(applicationId: number, dto: CreateReadingDto) {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { meters: true },
    });
    if (!app) throw new NotFoundException(`申请 #${applicationId} 不存在`);
    if (app.status !== 'ACTIVE') {
      throw new BadRequestException(`当前状态(${app.status})不可录数，需供电中方能录数`);
    }
    const meter = app.meters.find((m) => m.status === 'ACTIVE');
    if (!meter) throw new BadRequestException('当前没有在用电表');

    const prev = await this.previous(applicationId);
    const delta = dto.value - prev.previous.value;
    let reviewReason: string | null = null;
    if (delta < 0) reviewReason = 'READING_REGRESSION';
    else if (delta > this.jumpThreshold()) reviewReason = 'ABNORMAL_JUMP';

    const reading = await this.prisma.reading.create({
      data: {
        meterId: meter.id,
        applicationId,
        value: dto.value,
        kind: 'ROUTINE',
        status: reviewReason ? 'PENDING_REVIEW' : 'CONFIRMED',
        recordedBy: dto.recordedBy,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        reviewNote: reviewReason
          ? reviewReason === 'READING_REGRESSION'
            ? `读数倒退：上一笔 ${prev.previous.value}，本次 ${dto.value}`
            : `异常跃升：上一笔 ${prev.previous.value}，本次 ${dto.value}，超出阈值 ${this.jumpThreshold()} 度`
          : null,
      },
    });

    return {
      reading,
      previous: prev.previous,
      delta,
      reviewReason,
      message: reviewReason
        ? '读数异常，已进入复核，复核通过前不计入费用'
        : '录数成功',
    };
  }

  /** 待复核列表（电工端） */
  pendingReviews() {
    return this.prisma.reading.findMany({
      where: { status: 'PENDING_REVIEW' },
      include: {
        meter: true,
        application: { include: { team: true, box: true } },
      },
      orderBy: { id: 'asc' },
    });
  }

  /** 电工复核：通过则计入用量，驳回则不计费 */
  async review(readingId: number, dto: ReviewDto) {
    const reading = await this.prisma.reading.findUnique({ where: { id: readingId } });
    if (!reading) throw new NotFoundException(`读数 #${readingId} 不存在`);
    if (reading.status !== 'PENDING_REVIEW') {
      throw new BadRequestException('该读数不在待复核状态');
    }
    return this.prisma.reading.update({
      where: { id: readingId },
      data: {
        status: dto.approve ? 'CONFIRMED' : 'REJECTED',
        reviewedBy: dto.reviewedBy,
        reviewedAt: new Date(),
        reviewNote: dto.note
          ? `${reading.reviewNote ?? ''}｜复核：${dto.note}`
          : reading.reviewNote,
      },
    });
  }
}
