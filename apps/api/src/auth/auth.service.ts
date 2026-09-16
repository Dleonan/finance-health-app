import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../database/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, displayName: dto.displayName },
    });
    return this.createSessionResponse(user.id, user.email, dto.deviceName);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.createSessionResponse(user.id, user.email, dto.deviceName);
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!session) throw new UnauthorizedException('Invalid refresh token');

    const nextRefreshToken = this.generateRefreshToken();
    const nextSession = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) throw new UnauthorizedException('Refresh token already used');
      return tx.session.create({
        data: {
          userId: session.user.id,
          refreshTokenHash: this.hashRefreshToken(nextRefreshToken),
          deviceName: session.deviceName,
          expiresAt: this.refreshExpiry(),
        },
      });
    });
    return {
      ...(await this.accessTokenResponse(session.user.id, session.user.email, nextSession.id)),
      refreshToken: nextRefreshToken,
    };
  }

  async logout(userId: string, sessionId: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        timezone: true,
        locale: true,
        baseCurrency: true,
        createdAt: true,
      },
    });
  }

  private async createSessionResponse(userId: string, email: string, deviceName?: string) {
    const refreshToken = this.generateRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: this.hashRefreshToken(refreshToken),
        deviceName,
        expiresAt: this.refreshExpiry(),
      },
    });
    return {
      ...(await this.accessTokenResponse(userId, email, session.id)),
      refreshToken,
    };
  }

  private accessTokenResponse(userId: string, email: string, sessionId: string) {
    return this.jwt
      .signAsync(
        { sub: userId, sid: sessionId, type: 'access', email },
        { expiresIn: this.config.get<number>('JWT_ACCESS_TTL_SECONDS', 900) },
      )
      .then((accessToken) => ({ accessToken }));
  }

  private generateRefreshToken() {
    return randomBytes(48).toString('base64url');
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshExpiry() {
    const days = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 30);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
}
