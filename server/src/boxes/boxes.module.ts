import { Module } from '@nestjs/common';
import { BoxesController } from './boxes.controller';

@Module({ controllers: [BoxesController] })
export class BoxesModule {}
