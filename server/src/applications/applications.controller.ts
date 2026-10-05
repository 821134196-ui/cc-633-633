import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { ApplicationsService } from './applications.service';

class ApplyDto {
  @IsString() teamName!: string;
  @IsOptional() @IsString() contact?: string;
  @IsString() boxCode!: string;
  @IsString() purpose!: string;
  @IsString() plannedStart!: string;
  @IsOptional() @IsString() plannedEnd?: string;
}

class ActivateDto {
  @IsString() meterCode!: string;
  @IsNumber() initialValue!: number;
  @IsOptional() @IsString() recordedAt?: string;
  @IsOptional() @IsString() electrician?: string;
  @IsOptional() @IsString() safetyNote?: string;
}

class RejectDto {
  @IsString() reason!: string;
}

class RecordDto {
  @IsNumber() value!: number;
  @IsOptional() @IsString() recordedAt?: string;
  @IsOptional() @IsString() note?: string;
}

class ReviewDto {
  @IsString() action!: 'CONFIRM' | 'CORRECT';
  @IsOptional() @IsNumber() correctedValue?: number;
  @IsOptional() @IsString() reviewer?: string;
  @IsOptional() @IsString() note?: string;
}

class ChangeMeterDto {
  @IsNumber() oldFinalValue!: number;
  @IsString() newMeterCode!: string;
  @IsNumber() newInitialValue!: number;
  @IsOptional() @IsString() changedAt?: string;
  @IsOptional() @IsString() note?: string;
}

class StopDto {
  @IsNumber() finalValue!: number;
  @IsOptional() @IsString() recordedAt?: string;
  @IsOptional() @IsString() note?: string;
}

class ReleaseDto {
  @IsOptional() @IsString() electrician?: string;
  @IsOptional() @IsString() note?: string;
}

@Controller('api/applications')
export class ApplicationsController {
  constructor(private svc: ApplicationsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.getDetail(id);
  }

  @Post()
  apply(@Body() dto: ApplyDto) {
    return this.svc.apply(dto);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string, @Body() dto: ActivateDto) {
    return this.svc.activate(id, dto);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.svc.reject(id, dto);
  }

  @Post(':id/readings')
  record(@Param('id') id: string, @Body() dto: RecordDto) {
    return this.svc.recordReading(id, dto);
  }

  @Post(':id/readings/:rid/review')
  review(@Param('id') id: string, @Param('rid') rid: string, @Body() dto: ReviewDto) {
    return this.svc.reviewReading(id, rid, dto);
  }

  @Post(':id/change-meter')
  changeMeter(@Param('id') id: string, @Body() dto: ChangeMeterDto) {
    return this.svc.changeMeter(id, dto);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string, @Body() dto: StopDto) {
    return this.svc.stop(id, dto);
  }

  @Post(':id/release')
  release(@Param('id') id: string, @Body() dto: ReleaseDto) {
    return this.svc.release(id, dto);
  }

  @Post(':id/rebill')
  rebill(@Param('id') id: string) {
    return this.svc.regenerateBilling(id);
  }
}
