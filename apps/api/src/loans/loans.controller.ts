import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LoansService } from './loans.service';

@Controller('loans')
@UseGuards(JwtAuthGuard)
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.loans.list(user.id);
  }
}
