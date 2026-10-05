import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { resetDb } from './helpers';

/**
 * 关键场景集成测试：
 * 1. 申请→验收→录数→停用→结算→拆线 全流程
 * 2. 中途换表：旧表末值/新表初值分段接续，用量正确
 * 3. 跨月用电：读数链完整保留，逐月分摊与总量一致
 * 4. 停用未拆线前电箱不能再分配
 * 5. 并发申请同一电箱只允许一组成功
 * 6. 读数倒退/异常跃升进入复核，复核前不计费
 */
describe('临时用电申请与结算系统', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let teams: any[];
  let boxes: any[];

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const seeded = await resetDb(prisma);
    teams = seeded.teams;
    boxes = seeded.boxes;
  });

  const apply = (teamId: number, boxId: number) =>
    http().post('/api/applications').send({
      teamId,
      boxId,
      purpose: '钢筋加工机械用电',
      plannedStart: '2026-09-01T00:00:00Z',
      plannedEnd: '2026-12-31T00:00:00Z',
    });

  const approve = (id: number, initial: number, at?: string) =>
    http().post(`/api/applications/${id}/approve`).send({
      meterCode: `M-${id}-01`,
      initialReading: initial,
      electrician: '电工老王',
      wiringConfirmed: true,
      ...(at ? { at } : {}),
    });

  const addReading = (id: number, value: number, recordedAt?: string) =>
    http().post(`/api/applications/${id}/readings`).send({
      value,
      recordedBy: '班组小工',
      ...(recordedAt ? { recordedAt } : {}),
    });

  it('完整流程：申请→验收开通→录数→停用→结算→拆线释放', async () => {
    // 申请
    const created = await apply(teams[0].id, boxes[0].id);
    expect(created.status).toBe(201);
    const appId = created.body.id;
    expect(created.body.status).toBe('PENDING');

    // 电箱已被占用（待验收）
    let boxList = (await http().get('/api/boxes')).body;
    expect(boxList.find((b: any) => b.id === boxes[0].id).occupied).toBe(true);

    // 未验收前不能录数
    const early = await addReading(appId, 123);
    expect(early.status).toBe(400);

    // 电工验收接线 + 起始读数 100 → 开通
    const approved = await approve(appId, 100);
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('ACTIVE');

    // 录数 150 → 正常计入
    const r1 = await addReading(appId, 150);
    expect(r1.status).toBe(201);
    expect(r1.body.reading.status).toBe('CONFIRMED');
    expect(r1.body.previous.value).toBe(100);

    // 班组申请停用
    const stop = await http().post(`/api/applications/${appId}/stop`);
    expect(stop.body.status).toBe('STOPPING');

    // 电工核对末次读数 200 → 生成账单，用量 100 度 × 1.25 元
    const fin = await http()
      .post(`/api/applications/${appId}/finalize`)
      .send({ value: 200, electrician: '电工老王' });
    expect(fin.status).toBe(201);
    expect(fin.body.status).toBe('AWAIT_DISCONNECT');

    const bill = (await http().get(`/api/applications/${appId}/bill`)).body;
    expect(bill.totalUsage).toBe(100);
    expect(bill.unitPrice).toBe(1.25);
    expect(bill.totalAmount).toBe(125);
    expect(bill.detail.readings.map((r: any) => r.value)).toEqual([100, 150, 200]);

    // 拆线前电箱仍占用；拆线确认后释放
    boxList = (await http().get('/api/boxes')).body;
    expect(boxList.find((b: any) => b.id === boxes[0].id).occupied).toBe(true);
    const dis = await http()
      .post(`/api/applications/${appId}/disconnect`)
      .send({ electrician: '电工老王' });
    expect(dis.body.status).toBe('COMPLETED');
    boxList = (await http().get('/api/boxes')).body;
    expect(boxList.find((b: any) => b.id === boxes[0].id).occupied).toBe(false);
  });

  it('中途换表：旧表末值与新表初值分别记录，用量分段接续', async () => {
    const appId = (await apply(teams[0].id, boxes[0].id)).body.id;
    await approve(appId, 100);
    await addReading(appId, 150);
    await addReading(appId, 200);

    // 换表：旧表 M-x-01 末值 200，新表 M-x-02 初值 500（旧表拆下时的底数）
    const swap = await http().post(`/api/applications/${appId}/swap-meter`).send({
      oldFinal: 200,
      newCode: `M-${appId}-02`,
      newInitial: 500,
      electrician: '电工老王',
    });
    expect(swap.status).toBe(201);

    // 换表后录数基于新表：上一笔应为新表初值 500
    const r = await addReading(appId, 560);
    expect(r.body.previous.value).toBe(500);
    expect(r.body.reading.status).toBe('CONFIRMED');

    await http().post(`/api/applications/${appId}/stop`);
    const fin = await http()
      .post(`/api/applications/${appId}/finalize`)
      .send({ value: 580, electrician: '电工老王' });
    expect(fin.status).toBe(201);

    const bill = (await http().get(`/api/applications/${appId}/bill`)).body;
    // 旧表 200-100=100，新表 580-500=80，合计 180
    expect(bill.totalUsage).toBe(180);
    expect(bill.totalAmount).toBe(225);
    expect(bill.detail.segments).toHaveLength(2);
    expect(bill.detail.segments[0]).toMatchObject({ start: 100, end: 200, usage: 100 });
    expect(bill.detail.segments[1]).toMatchObject({ start: 500, end: 580, usage: 80 });
    // 换表两笔关键读数都在链上，可核对完整过程
    const kinds = bill.detail.readings.map((x: any) => x.kind);
    expect(kinds).toContain('SWAP_OLD_FINAL');
    expect(kinds).toContain('SWAP_NEW_INITIAL');
  });

  it('换表时旧表末值小于上一笔读数会被拒绝', async () => {
    const appId = (await apply(teams[0].id, boxes[0].id)).body.id;
    await approve(appId, 100);
    await addReading(appId, 200);
    const swap = await http().post(`/api/applications/${appId}/swap-meter`).send({
      oldFinal: 150, // 小于上一笔 200
      newCode: `M-${appId}-02`,
      newInitial: 0,
      electrician: '电工老王',
    });
    expect(swap.status).toBe(400);
  });

  it('跨月用电：读数链完整保留，逐月用量与总量一致', async () => {
    const appId = (await apply(teams[0].id, boxes[0].id)).body.id;
    await approve(appId, 100, '2026-09-28T08:00:00Z');
    await addReading(appId, 180, '2026-09-30T18:00:00Z'); // 9 月 +80
    await addReading(appId, 260, '2026-10-02T08:00:00Z'); // 10 月 +80
    await http().post(`/api/applications/${appId}/stop`);
    await http()
      .post(`/api/applications/${appId}/finalize`)
      .send({ value: 300, electrician: '电工老王', at: '2026-10-05T08:00:00Z' }); // 10 月 +40

    const bill = (await http().get(`/api/applications/${appId}/bill`)).body;
    expect(bill.totalUsage).toBe(200);
    // 逐月分摊
    expect(bill.detail.monthly).toEqual([
      { month: '2026-09', usage: 80 },
      { month: '2026-10', usage: 120 },
    ]);
    // 逐月之和 = 总量
    const monthlySum = bill.detail.monthly.reduce((s: number, m: any) => s + m.usage, 0);
    expect(monthlySum).toBe(bill.totalUsage);
    // 完整读数链（含跨月前后读数）保留在账单中
    expect(bill.detail.readings.map((r: any) => r.value)).toEqual([100, 180, 260, 300]);
  });

  it('停用未拆线前电箱不能再分配，拆线确认后才能再申请', async () => {
    const appId = (await apply(teams[0].id, boxes[0].id)).body.id;
    await approve(appId, 100);
    await http().post(`/api/applications/${appId}/stop`);
    await http()
      .post(`/api/applications/${appId}/finalize`)
      .send({ value: 160, electrician: '电工老王' });

    // 已结算但未拆线：电箱仍占用，其他班组申请被拒
    const blocked = await apply(teams[1].id, boxes[0].id);
    expect(blocked.status).toBe(409);

    // 电工确认拆线 → 释放 → 可申请
    await http().post(`/api/applications/${appId}/disconnect`).send({ electrician: '电工老王' });
    const ok = await apply(teams[1].id, boxes[0].id);
    expect(ok.status).toBe(201);
  });

  it('并发申请同一电箱：只允许一组成功', async () => {
    const [r1, r2] = await Promise.all([
      apply(teams[0].id, boxes[1].id),
      apply(teams[1].id, boxes[1].id),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    // 数据库中该电箱只有一条占用记录
    const occupancies = await prisma.boxOccupancy.findMany({
      where: { boxId: boxes[1].id },
    });
    expect(occupancies).toHaveLength(1);
  });

  it('同一电箱不能同时分配给两个班组（顺序申请第二单被拒）', async () => {
    const first = await apply(teams[0].id, boxes[2].id);
    expect(first.status).toBe(201);
    const second = await apply(teams[1].id, boxes[2].id);
    expect(second.status).toBe(409);
  });

  it('读数倒退或异常跃升进入复核，复核通过前不计入费用', async () => {
    const appId = (await apply(teams[0].id, boxes[0].id)).body.id;
    await approve(appId, 100);

    // 倒退：90 < 100 → 待复核
    const reg = await addReading(appId, 90);
    expect(reg.body.reading.status).toBe('PENDING_REVIEW');
    expect(reg.body.reviewReason).toBe('READING_REGRESSION');

    // 跃升：700 - 100 = 600 > 阈值 500 → 待复核
    const jump = await addReading(appId, 700);
    expect(jump.body.reading.status).toBe('PENDING_REVIEW');
    expect(jump.body.reviewReason).toBe('ABNORMAL_JUMP');

    // 电工复核列表有两条
    const reviews = (await http().get('/api/reviews')).body;
    expect(reviews).toHaveLength(2);

    // 驳回倒退的 90，通过跃升的 700（现场确认表计故障已修复）
    await http()
      .post(`/api/readings/${reg.body.reading.id}/review`)
      .send({ approve: false, reviewedBy: '电工老王', note: '读数有误，重新抄表' });
    await http()
      .post(`/api/readings/${jump.body.reading.id}/review`)
      .send({ approve: true, reviewedBy: '电工老王', note: '现场确认无误' });

    // 上一笔有效读数现在是 700（被驳回的 90 不算）
    const prev = (await http().get(`/api/applications/${appId}/previous-reading`)).body;
    expect(prev.previous.value).toBe(700);

    // 结算：用量 = 750 - 100 = 650，倒退读数不计费
    await http().post(`/api/applications/${appId}/stop`);
    await http()
      .post(`/api/applications/${appId}/finalize`)
      .send({ value: 750, electrician: '电工老王' });
    const bill = (await http().get(`/api/applications/${appId}/bill`)).body;
    expect(bill.totalUsage).toBe(650);
    expect(bill.detail.readings.map((r: any) => r.value)).toEqual([100, 700, 750]);
  });

  it('末次读数异常需电工现场确认后才能入账', async () => {
    const appId = (await apply(teams[0].id, boxes[0].id)).body.id;
    await approve(appId, 100);
    await http().post(`/api/applications/${appId}/stop`);

    // 末次读数倒退 → 409，提示现场复核
    const bad = await http()
      .post(`/api/applications/${appId}/finalize`)
      .send({ value: 50, electrician: '电工老王' });
    expect(bad.status).toBe(409);
    expect(bad.body.reason ?? bad.body.message).toBeDefined();

    // 电工现场确认后强制入账（用量按 0 兜底，不出现负用量）
    const ok = await http()
      .post(`/api/applications/${appId}/finalize`)
      .send({ value: 50, electrician: '电工老王', confirmAbnormal: true });
    expect(ok.status).toBe(201);
    const bill = (await http().get(`/api/applications/${appId}/bill`)).body;
    expect(bill.totalUsage).toBe(0);
  });

  it('接线未验收确认不能开通供电', async () => {
    const appId = (await apply(teams[0].id, boxes[0].id)).body.id;
    const res = await http().post(`/api/applications/${appId}/approve`).send({
      meterCode: 'M-X',
      initialReading: 0,
      electrician: '电工老王',
      wiringConfirmed: false,
    });
    expect(res.status).toBe(400);
  });
});
