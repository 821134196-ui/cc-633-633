import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('boxes')
export class BoxesController {
  constructor(private prisma: PrismaService) {}

  /** 电箱看板：空闲 / 待验收 / 供电中 / 停用流程中（占用未释放） */
  @Get()
  async list() {
    const boxes = await this.prisma.electricBox.findMany({
      include: {
        occupancy: { include: { application: { include: { team: true } } } },
      },
      orderBy: { code: 'asc' },
    });
    return boxes.map((b) => ({
      id: b.id,
      code: b.code,
      location: b.location,
      capacityKw: b.capacityKw,
      occupied: !!b.occupancy,
      status: b.occupancy ? b.occupancy.application.status : 'IDLE',
      currentApplication: b.occupancy
        ? {
            id: b.occupancy.application.id,
            teamName: b.occupancy.application.team.name,
            status: b.occupancy.application.status,
            purpose: b.occupancy.application.purpose,
          }
        : null,
    }));
  }
}
