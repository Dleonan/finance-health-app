import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CardsService } from './cards.service';

@Controller('cards')
@UseGuards(JwtAuthGuard)
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.cards.list(user.id);
  }

  @Get(':id/bills')
  bills(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cards.bills(user.id, id);
  }
}
