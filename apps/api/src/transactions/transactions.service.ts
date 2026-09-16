import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TransactionDirection } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { TransactionsQueryDto } from './dto/transactions-query.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: TransactionsQueryDto) {
    const where: Prisma.TransactionWhereInput = {
      deletedAt: null,
      account: { connection: { userId } },
    };
    if (query.accountId) where.accountId = query.accountId;
    if (query.categoryId) where.userCategoryId = query.categoryId;
    if (query.direction) where.direction = query.direction;
    if (query.from || query.to) {
      where.postedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { merchantRaw: { contains: query.search, mode: 'insensitive' } },
        { merchantNormalized: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.transaction.findMany({
      where,
      take: query.limit + 1,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      include: { account: { select: { id: true, name: true, currency: true } } },
    });
    const hasMore = rows.length > query.limit;
    const data = (hasMore ? rows.slice(0, -1) : rows).map((row) => this.view(row));
    return { data, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null, hasMore };
  }

  async get(userId: string, id: string) {
    const row = await this.prisma.transaction.findFirst({
      where: { id, deletedAt: null, account: { connection: { userId } } },
      include: { account: { select: { id: true, name: true, currency: true } } },
    });
    if (!row) throw new NotFoundException('Transaction not found');
    return this.view(row);
  }

  private view(row: {
    id: string;
    postedAt: Date;
    description: string;
    merchantRaw: string | null;
    merchantNormalized: string | null;
    amount: Prisma.Decimal;
    direction: TransactionDirection;
    providerCategoryId: string | null;
    userCategoryId: string | null;
    installmentNumber: number | null;
    installmentTotal: number | null;
    isTransfer: boolean;
    isRecurringCandidate: boolean;
    account: { id: string; name: string; currency: string };
  }) {
    return {
      id: row.id,
      postedAt: row.postedAt,
      description: row.description,
      merchantRaw: row.merchantRaw,
      merchantNormalized: row.merchantNormalized,
      amount: row.amount.toFixed(2),
      direction: row.direction,
      providerCategoryId: row.providerCategoryId,
      userCategoryId: row.userCategoryId,
      installmentNumber: row.installmentNumber,
      installmentTotal: row.installmentTotal,
      isTransfer: row.isTransfer,
      isRecurringCandidate: row.isRecurringCandidate,
      account: row.account,
    };
  }
}
