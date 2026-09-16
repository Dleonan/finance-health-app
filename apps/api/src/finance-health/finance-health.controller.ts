import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FinancialHealthPreviewDto } from './dto/financial-health-preview.dto';
import { FinancialSummaryService } from './financial-summary.service';
import { FinanceHealthService } from './finance-health.service';

@Controller('financial-health')
@UseGuards(JwtAuthGuard)
export class FinanceHealthController {
  constructor(
    private readonly service: FinanceHealthService,
    private readonly summary: FinancialSummaryService,
  ) {}

  @Post('preview')
  preview(@Body() input: FinancialHealthPreviewDto) {
    return this.service.calculate(input);
  }

  @Get('current')
  current(@CurrentUser() user: AuthenticatedUser) {
    return this.summary.current(user.id);
  }

  @Get('history')
  history(@CurrentUser() user: AuthenticatedUser) {
    return this.summary.history(user.id);
  }
}
