import { Controller, Get, Param, Query } from '@nestjs/common';
import { MeterDeviceService } from './meter-device.service';
import { PricingService } from './pricing.service';

/**
 * 本地模拟接口：智能电表远程抄表 + 收费计价。
 */
@Controller('mock')
export class MockController {
  constructor(
    private meterDevice: MeterDeviceService,
    private pricing: PricingService,
  ) {}

  /** 模拟电表接口：远程读取某表当前示数 */
  @Get('meter/:code/reading')
  meterReading(@Param('code') code: string) {
    return this.meterDevice.readCurrentValue(code);
  }

  /** 模拟收费接口：按用量报价 */
  @Get('pricing/quote')
  quote(@Query('usage') usage: string) {
    return this.pricing.quote(Number(usage) || 0);
  }
}
