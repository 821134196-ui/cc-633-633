import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsNumber, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

class TariffDto {
  @IsString() name!: string;
  @IsNumber() pricePerKwh!: number;
  @IsString() effectiveFrom!: string;
}

@Controller('api/tariffs')
export class TariffsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.tariffRate.findMany({ orderBy: { effectiveFrom: 'desc' } });
  }

  @Post()
  create(@Body() dto: TariffDto) {
    return this.prisma.tariffRate.create({
      data: {
        name: dto.name,
        pricePerKwh: dto.pricePerKwh,
        effectiveFrom: new Date(dto.effectiveFrom),
      },
    });
  }
}
