import { PrismaClient } from '@prisma/client';

/** 首次启动写入演示数据：4 个电箱 + 一个默认电价 */
export async function seed(prisma: PrismaClient) {
  const boxCount = await prisma.box.count();
  if (boxCount === 0) {
    await prisma.box.createMany({
      data: [
        { code: 'DX-101', name: '一级配电箱', location: '工地东门' },
        { code: 'DX-102', name: '二级配电箱', location: '1 号楼南侧' },
        { code: 'DX-103', name: '二级配电箱', location: '2 号楼北侧' },
        { code: 'DX-104', name: '三级开关箱', location: '钢筋加工棚' },
      ],
    });
    // eslint-disable-next-line no-console
    console.log('🌱 已写入演示电箱 DX-101 ~ DX-104');
  }

  const tariffCount = await prisma.tariffRate.count();
  if (tariffCount === 0) {
    await prisma.tariffRate.create({
      data: { name: '施工临时用电', pricePerKwh: 1.2, effectiveFrom: new Date('2026-01-01') },
    });
    // eslint-disable-next-line no-console
    console.log('🌱 已写入默认电价 ¥1.20/kWh（2026-01-01 起）');
  }
}
