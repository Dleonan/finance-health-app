import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import type { AuthenticatedUser } from './auth.types';

type AccessTokenPayload = {
  sub: string;
  sid: string;
  type: 'access';
};

type AuthenticatedRequest = {
  headers: { authorization?: string };
  user?: AuthenticatedUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;

    if (!token) throw new UnauthorizedException('Authentication required');

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      if (payload.type !== 'access' || !payload.sub || !payload.sid) {
        throw new UnauthorizedException('Invalid access token');
      }

      const session = await this.prisma.session.findFirst({
        where: {
          id: payload.sid,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: { user: { select: { id: true, email: true } } },
      });

      if (!session) throw new UnauthorizedException('Session expired');
      request.user = {
        id: session.user.id,
        email: session.user.email,
        sessionId: session.id,
      };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
