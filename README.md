# 施工现场临时用电申请与电表结算系统

工地班组按电箱申请临时供电，电工验收接线安全并登记起始读数后开通；使用中手机抄表（异常读数先复核、不计费），支持中途换表分段接续；停用时核对末次读数按实际用量结算，电工确认拆线后电箱才释放。

## 技术栈

- 后端：NestJS + Prisma + SQLite（电表/收费接口本地模拟）
- 前端：React + Vite（含手机录数页）
- 一条命令启动，无需外部服务

## 快速开始

```bash
npm run install:all   # 首次：安装 server 与 web 依赖
npm run dev           # 初始化数据库(含种子数据)并同时启动前后端
```

- 前端：http://localhost:5173 （电箱看板 / 申请 / 录数 / 复核 / 账单）
- 后端：http://localhost:3000/api

## 测试

```bash
npm test
```

覆盖关键场景：换表与跨月结算用量、拆线前禁止再分配、并发申请同一电箱只允许一组成功、异常读数复核不计费。

## 业务流程

```
班组申请(占用电箱) → 电工验收接线+起始读数(开通供电) → 手机日常录数
   → (可选)中途换表：旧表末值/新表初值 → 班组申请停用
   → 电工核对末次读数(生成账单) → 电工确认拆线(释放电箱) → 完结
```

- **占用与互斥**：申请提交即占用电箱，`BoxOccupancy.boxId` 唯一约束保证一个电箱同一时刻只能分配给一组；停用/结算不释放电箱，电工确认拆线后才释放。
- **异常读数复核**：手机录数页展示上一笔有效读数；本次读数倒退或跃升超过阈值（默认 500 度，`server/.env` 的 `JUMP_THRESHOLD` 可调）自动进入复核，复核通过前不参与计费。
- **换表接续**：分别记录旧表末值（`SWAP_OLD_FINAL`）与新表初值（`SWAP_NEW_INITIAL`），用量按表分段计算后累加。
- **跨月结算**：全部有效读数链保留在账单明细中，逐月用量按相邻读数差分摊，总和与分段总量一致，可逐笔核对完整使用过程。
- **模拟接口**：`GET /api/mock/meter/:code/reading` 模拟远程抄表；`GET /api/mock/pricing/quote?usage=100` 模拟收费计价（单价见 `server/.env` 的 `UNIT_PRICE`）。

## 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/boxes | 电箱看板（空闲/占用状态） |
| GET | /api/teams | 班组列表 |
| POST | /api/applications | 班组提交用电申请 |
| POST | /api/applications/:id/approve | 电工验收接线 + 起始读数，开通供电 |
| POST | /api/applications/:id/reject | 驳回并释放电箱 |
| GET | /api/applications/:id/previous-reading | 上一笔有效读数（手机录数页） |
| POST | /api/applications/:id/readings | 手机录数（异常自动进复核） |
| GET | /api/reviews | 待复核读数列表 |
| POST | /api/readings/:id/review | 复核通过/驳回 |
| POST | /api/applications/:id/swap-meter | 中途换表 |
| POST | /api/applications/:id/stop | 班组申请停用 |
| POST | /api/applications/:id/finalize | 电工核对末次读数，生成账单 |
| POST | /api/applications/:id/disconnect | 确认拆线，释放电箱 |
| GET | /api/applications/:id/bill | 账单（分段/逐月明细 + 读数链） |

## 目录结构

```
server/            NestJS 后端
  prisma/          schema、SQLite 库、种子数据
  src/             控制器与服务（用量计算 usage.service.ts 为核心）
  test/            关键场景集成测试（独立 test.db）
web/               React 前端（Vite，代理 /api 到 3000）
```
