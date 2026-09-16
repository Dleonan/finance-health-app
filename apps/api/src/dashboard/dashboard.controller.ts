import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.today(user.id);
  }

  @Get('today')
  getToday(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.today(user.id);
  }
}
