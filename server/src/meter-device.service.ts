import { Injectable } from '@nestjs/common';

/**
 * 电表接口（本地模拟）。
 * 真实场景下对接智能电表/集抄平台，这里用确定性的模拟值代替，
 * 便于演示"远程抄表"效果：读数随时间单调递增。
 */
@Injectable()
export class MeterDeviceService {
  /** 模拟远程抄表：以 2026-01-01 为基准，按 0.4 度/分钟 递增 */
  readCurrentValue(meterCode: string) {
    const base = 1000 + hashCode(meterCode) % 500;
    const minutes = Math.floor(
      (Date.now() - new Date('2026-01-01T00:00:00Z').getTime()) / 60000,
    );
    const value = Math.round((base + minutes * 0.4) * 10) / 10;
    return {
      code: meterCode,
      value,
      at: new Date().toISOString(),
      source: 'local-mock',
    };
  }
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
