import { Controller, Get, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('applications')
export class BillsController {
  constructor(private prisma: PrismaService) {}

  /** 账单：总量、费用、分段/逐月明细与完整读数链 */
  @Get(':id/bill')
  async bill(@Param('id', ParseIntPipe) id: number) {
    const bill = await this.prisma.bill.findUnique({
      where: { applicationId: id },
      include: { application: { include: { team: true, box: true } } },
    });
    if (!bill) throw new NotFoundException('账单尚未生成（停用核表后生成）');
    return { ...bill, detail: JSON.parse(bill.detail) };
  }
}
