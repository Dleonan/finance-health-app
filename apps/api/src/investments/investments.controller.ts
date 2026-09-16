import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InvestmentsService } from './investments.service';

@Controller('investments')
@UseGuards(JwtAuthGuard)
export class InvestmentsController {
  constructor(private readonly investments: InvestmentsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.investments.list(user.id);
  }
}
