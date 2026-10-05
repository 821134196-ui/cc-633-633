// 种子数据：班组与配电箱。仅当数据库为空时写入，重复启动不会清空业务数据。
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const teamCount = await prisma.team.count();
  if (teamCount > 0) {
    console.log('[seed] 已有数据，跳过种子初始化');
    return;
  }

  await prisma.team.createMany({
    data: [
      { name: '钢筋一班', contact: '张铁柱', phone: '13800000001' },
      { name: '模板二班', contact: '李木生', phone: '13800000002' },
      { name: '混凝土班', contact: '王振捣', phone: '13800000003' },
      { name: '机电安装班', contact: '赵管线', phone: '13800000004' },
    ],
  });

  await prisma.electricBox.createMany({
    data: [
      { code: 'DB-01', location: '一期东北角', capacityKw: 63 },
      { code: 'DB-02', location: '一期西南角', capacityKw: 63 },
      { code: 'DB-03', location: '塔吊专用', capacityKw: 90 },
      { code: 'DB-04', location: '钢筋加工区', capacityKw: 40 },
      { code: 'DB-05', location: '生活区', capacityKw: 32 },
      { code: 'DB-06', location: '二期场地', capacityKw: 63 },
    ],
  });

  console.log('[seed] 已初始化 4 个班组、6 个配电箱');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
