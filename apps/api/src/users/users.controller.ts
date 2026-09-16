import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }
}
