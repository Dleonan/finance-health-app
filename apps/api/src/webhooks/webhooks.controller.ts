import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly service: WebhooksService,
    private readonly config: ConfigService,
  ) {}

  @Post('pluggy')
  @SkipThrottle()
  async pluggyWebhook(
    @Headers('x-finance-health-secret') secret: string | undefined,
    @Body() payload: unknown,
  ) {
    const expected = this.config.get<string>('WEBHOOK_SHARED_SECRET');
    if (!expected || !secret || secret !== expected)
      throw new UnauthorizedException('Invalid webhook secret');
    return this.service.handle(payload);
  }
}
