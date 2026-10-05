import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

class BoxDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() location?: string;
}

@Controller('api/boxes')
export class BoxesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.box.findMany({
      orderBy: { code: 'asc' },
      include: {
        currentApplication: { include: { team: true } },
      },
    });
  }

  @Post()
  create(@Body() dto: BoxDto) {
    return this.prisma.box.create({
      data: { code: dto.code, name: dto.name, location: dto.location },
    });
  }
}
