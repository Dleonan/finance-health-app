import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/auth.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompleteConnectionDto } from './dto/complete-connection.dto';
import { ConnectionsService } from './connections.service';

@Controller('connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.connections.list(user.id);
  }

  @Post('pluggy/token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  connectToken(@CurrentUser() user: AuthenticatedUser) {
    return this.connections.createToken(user.id);
  }

  @Post('pluggy/complete')
  complete(@CurrentUser() user: AuthenticatedUser, @Body() dto: CompleteConnectionDto) {
    return this.connections.complete(user.id, dto);
  }

  @Post(':id/reconnect-token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reconnectToken(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.connections.reconnectToken(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.connections.remove(user.id, id);
  }
}
