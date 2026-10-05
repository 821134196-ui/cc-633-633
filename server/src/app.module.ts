import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PricingService } from './pricing.service';
import { MeterDeviceService } from './meter-device.service';
import { UsageService } from './usage.service';
import { BoxesController } from './boxes.controller';
import { TeamsController } from './teams.controller';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ReadingsController } from './readings.controller';
import { ReadingsService } from './readings.service';
import { BillsController } from './bills.controller';
import { MockController } from './mock.controller';

@Module({
  controllers: [
    BoxesController,
    TeamsController,
    ApplicationsController,
    ReadingsController,
    BillsController,
    MockController,
  ],
  providers: [
    PrismaService,
    PricingService,
    MeterDeviceService,
    UsageService,
    ApplicationsService,
    ReadingsService,
  ],
})
export class AppModule {}
