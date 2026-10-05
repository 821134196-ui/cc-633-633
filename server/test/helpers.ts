import { PrismaClient } from '@prisma/client';

/** 每个用例前清库并重建基础数据（班组/电箱） */
export async function resetDb(prisma: PrismaClient) {
  await prisma.reading.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.meter.deleteMany();
  await prisma.boxOccupancy.deleteMany();
  await prisma.application.deleteMany();
  await prisma.electricBox.deleteMany();
  await prisma.team.deleteMany();

  await prisma.team.createMany({
    data: [{ name: '钢筋一班' }, { name: '模板二班' }, { name: '混凝土班' }],
  });
  await prisma.electricBox.createMany({
    data: [
      { code: 'DB-01', location: '东北角', capacityKw: 63 },
      { code: 'DB-02', location: '西南角', capacityKw: 63 },
      { code: 'DB-03', location: '加工区', capacityKw: 40 },
    ],
  });

  const teams = await prisma.team.findMany({ orderBy: { id: 'asc' } });
  const boxes = await prisma.electricBox.findMany({ orderBy: { id: 'asc' } });
  return { teams, boxes };
}
