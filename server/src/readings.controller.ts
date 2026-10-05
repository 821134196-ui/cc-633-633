import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ReadingsService } from './readings.service';
import { CreateReadingDto, ReviewDto } from './dto';

@Controller()
export class ReadingsController {
  constructor(private service: ReadingsService) {}

  /** 手机录数页：上一笔有效读数 */
  @Get('applications/:id/previous-reading')
  previous(@Param('id', ParseIntPipe) id: number) {
    return this.service.previous(id);
  }

  /** 手机录数提交 */
  @Post('applications/:id/readings')
  create(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateReadingDto) {
    return this.service.create(id, dto);
  }

  /** 电工端待复核列表 */
  @Get('reviews')
  pendingReviews() {
    return this.service.pendingReviews();
  }

  /** 电工复核 */
  @Post('readings/:id/review')
  review(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewDto) {
    return this.service.review(id, dto);
  }
}
