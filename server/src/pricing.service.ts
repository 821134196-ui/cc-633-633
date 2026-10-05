import { Injectable } from '@nestjs/common';

/**
 * 收费接口（本地模拟）。
 * 真实场景下这里对接公司计价/财务系统，本系统用固定单价模拟。
 */
@Injectable()
export class PricingService {
  getUnitPrice(): number {
    return Number(process.env.UNIT_PRICE) || 1.25;
  }

  /** 模拟收费接口报价：按用量返回单价与金额 */
  quote(usageKwh: number) {
    const unitPrice = this.getUnitPrice();
    return {
      usageKwh,
      unitPrice,
      amount: Math.round(usageKwh * unitPrice * 100) / 100,
      currency: 'CNY',
      source: 'local-mock',
    };
  }
}
