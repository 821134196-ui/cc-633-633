# 施工现场临时用电申请与电表结算系统

班组按电箱申请临时供电 → 电工验收接线并确认起始读数后开通 → 手机录数（倒退/异常跃升先复核）→ 中途换表分段接续 → 停用按实际用量出账（支持跨月）→ 电工拆线后电箱才释放。

技术栈：TypeScript · NestJS · React(Vite) · Prisma · SQLite。电表校表与收费均为**本地模拟接口**，无外部依赖。

## 一条命令启动

```bash
npm install
npm start
```

- 前端（手机录数页）：http://localhost:5173
- 后端 API：http://localhost:3001/api

首次启动自动建库并写入演示数据（电箱 DX-101~104、电价 ¥1.20/kWh）。

## 业务流程与关键规则

| 阶段 | 角色 | 规则 |
|---|---|---|
| 申请 | 班组 | 填写用电时间、用途；电箱原子占用，并发申请同一电箱只有一组成功（DB 条件 UPDATE） |
| 验收 | 电工 | 检查接线安全 + 确认电表起始读数后才供电；不合格可驳回并释放电箱 |
| 录数 | 电工/手机 | 页面同时展示**上一笔读数**；倒退或异常跃升 → `PENDING_REVIEW`，**不能直接计费**，需现场确认或修正 |
| 换表 | 电工 | 记录旧表末值 + 新表初值；两段差值接续求和，跨表差值不参与计算 |
| 停用 | 电工 | 核对末次读数生成账单；**停用 ≠ 电箱空闲**，拆线前其他班组无法申请 |
| 结算 | 系统 | 分段用量 + 跨月按天分摊；有待复核读数时账单暂挂，复核完成自动转最终账单并调用模拟收费 |
| 拆线 | 电工 | 确认拆线后电箱回到 `FREE`，才可重新分配 |

状态机：`PENDING → ACTIVE → STOPPED → RELEASED`（PENDING 可 `REJECTED`）

## 自动化验证（四个关键点 + 异常复核）

先启动后端，再另开终端：

```bash
npm run verify
```

覆盖：
1. **并发申请同一电箱**：3 个并发请求恰好 1 个成功、2 个 409；
2. **拆线前不能再分配**：停用后、拆线前申请被 409 拒绝（提示待拆线）；
3. **换表用量**：旧表 100→800（700）+ 新表 0→700（700）= **1400 kWh**；
4. **跨月结算**：2026-01/02/03 三月分摊之和严格等于总用量 1400；
5. 异常跃升（99999）与倒退（100）先暂挂不计费，复核修正后才出最终账单 ¥1680。

## API 摘要

- `GET/POST /api/boxes` 电箱列表/新建
- `POST /api/applications` 申请（body: teamName, boxCode, purpose, plannedStart, plannedEnd?）
- `POST /api/applications/:id/activate` 验收开通（meterCode, initialValue, recordedAt?）
- `POST /api/applications/:id/reject` 驳回
- `POST /api/applications/:id/readings` 手机录数（自动异常检测，返回上一笔与异常原因）
- `POST /api/applications/:id/readings/:rid/review` 复核：CONFIRM / CORRECT
- `POST /api/applications/:id/change-meter` 换表（oldFinalValue, newMeterCode, newInitialValue）
- `POST /api/applications/:id/stop` 停用（finalValue）
- `POST /api/applications/:id/release` 拆线释放
- `GET /api/applications/:id` 详情（含读数链、分段、跨月账单预览）
