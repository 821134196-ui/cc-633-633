import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import {
  ApproveDto,
  CreateApplicationDto,
  DisconnectDto,
  FinalizeDto,
  RejectDto,
  SwapMeterDto,
} from './dto';

@Controller('applications')
export class ApplicationsController {
  constructor(private service: ApplicationsService) {}

  @Get()
  list(@Query('status') status?: string, @Query('teamId') teamId?: string) {
    return this.service.list(status, teamId ? Number(teamId) : undefined);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.getOrThrow(id);
  }

  @Post()
  create(@Body() dto: CreateApplicationDto) {
    return this.service.create(dto);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ApproveDto) {
    return this.service.approve(id, dto);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectDto) {
    return this.service.reject(id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.service.cancel(id);
  }

  @Post(':id/stop')
  stop(@Param('id', ParseIntPipe) id: number) {
    return this.service.requestStop(id);
  }

  @Post(':id/swap-meter')
  swapMeter(@Param('id', ParseIntPipe) id: number, @Body() dto: SwapMeterDto) {
    return this.service.swapMeter(id, dto);
  }

  @Post(':id/finalize')
  finalize(@Param('id', ParseIntPipe) id: number, @Body() dto: FinalizeDto) {
    return this.service.finalize(id, dto);
  }

  @Post(':id/disconnect')
  disconnect(@Param('id', ParseIntPipe) id: number, @Body() dto: DisconnectDto) {
    return this.service.disconnect(id, dto);
  }
}
