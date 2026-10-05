import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { BillingService } from '../billing/billing.service';
import { MeterSimService } from '../meter/meter-sim.service';

@Module({
  controllers: [ApplicationsController],
  providers: [ApplicationsService, BillingService, MeterSimService],
})
export class ApplicationsModule {}
