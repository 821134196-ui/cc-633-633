import { Injectable, Logger } from '@nestjs/common';

/**
 * 电表设备 & 收费接口的本地模拟（真实环境对接硬件平台 / 支付网关）。
 * 不产生任何外部网络调用。
 */
@Injectable()
export class MeterSimService {
  private readonly logger = new Logger('MeterSim');

  /** 模拟远端校表：返回读数是否可信（始终可信，但会校验物理范围） */
  async verifyReading(meterCode: string, value: number): Promise<{ ok: boolean; message: string }> {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, message: `表 ${meterCode} 读数越界: ${value}` };
    }
    this.logger.log(`[模拟电表] 校表 ${meterCode} = ${value} kWh ✓`);
    return { ok: true, message: '模拟校表通过' };
  }

  /** 模拟新表出厂初值（一般为 0，允许少量底码） */
  async factoryInitial(meterCode: string): Promise<number> {
    this.logger.log(`[模拟电表] 新表 ${meterCode} 出厂初值 0`);
    return 0;
  }

  /** 模拟收费接口：按单价出账 */
  async charge(params: { applicationCode: string; usage: number; unitPrice: number }): Promise<{
    channel: 'LOCAL_MOCK';
    orderNo: string;
    amount: number;
  }> {
    const amount = +(params.usage * params.unitPrice).toFixed(2);
    const orderNo = `MOCK-${params.applicationCode}-${Date.now()}`;
    this.logger.log(
      `[模拟收费] 申请 ${params.applicationCode}：${params.usage} kWh × ¥${params.unitPrice} = ¥${amount}，单号 ${orderNo}`,
    );
    return { channel: 'LOCAL_MOCK', orderNo, amount };
  }
}
