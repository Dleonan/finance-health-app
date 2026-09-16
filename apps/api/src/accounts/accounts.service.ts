import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { connection: { userId } },
      orderBy: { name: 'asc' },
      include: {
        connection: { select: { id: true, institution: true, status: true, lastSyncedAt: true } },
      },
    });
    return accounts.map((account) => this.view(account));
  }

  async get(userId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, connection: { userId } },
      include: {
        connection: { select: { id: true, institution: true, status: true, lastSyncedAt: true } },
      },
    });
    if (!account) throw new NotFoundException('Account not found');
    return this.view(account);
  }

  private view(account: Awaited<ReturnType<AccountsService['findAccountShape']>>) {
    return {
      id: account.id,
      name: account.name,
      kind: account.kind,
      currency: account.currency,
      currentBalance: account.currentBalance?.toFixed(2) ?? null,
      availableBalance: account.availableBalance?.toFixed(2) ?? null,
      creditLimit: account.creditLimit?.toFixed(2) ?? null,
      connection: account.connection,
      lastProviderSyncAt: account.lastProviderSyncAt,
    };
  }

  private findAccountShape() {
    return this.prisma.account.findFirstOrThrow({
      include: {
        connection: { select: { id: true, institution: true, status: true, lastSyncedAt: true } },
      },
    });
  }
}
