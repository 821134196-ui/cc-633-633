import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('teams')
export class TeamsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.team.findMany({ orderBy: { id: 'asc' } });
  }
}
