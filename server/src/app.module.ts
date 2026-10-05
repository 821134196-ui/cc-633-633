import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ApplicationsModule } from './applications/applications.module';
import { BoxesModule } from './boxes/boxes.module';
import { TariffsModule } from './tariffs/tariffs.module';

@Module({
  imports: [PrismaModule, ApplicationsModule, BoxesModule, TariffsModule],
})
export class AppModule {}
