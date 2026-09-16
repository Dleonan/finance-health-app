import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreditCardBillStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CardsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const cards = await this.prisma.account.findMany({
      where: { kind: 'CREDIT_CARD', connection: { userId } },
      orderBy: { name: 'asc' },
    });
    return cards.map((card) => ({
      id: card.id,
      name: card.name,
      currency: card.currency,
      currentBalance: card.currentBalance?.toFixed(2) ?? null,
      availableBalance: card.availableBalance?.toFixed(2) ?? null,
      creditLimit: card.creditLimit?.toFixed(2) ?? null,
      utilization:
        card.creditLimit && card.creditLimit.gt(0) && card.currentBalance
          ? card.currentBalance.div(card.creditLimit).toFixed(4)
          : null,
    }));
  }

  async bills(userId: string, cardId: string) {
    const card = await this.prisma.account.findFirst({
      where: { id: cardId, kind: 'CREDIT_CARD', connection: { userId } },
    });
    if (!card) throw new NotFoundException('Card not found');
    const rows = await this.prisma.creditCardBill.findMany({
      where: { accountId: cardId },
      orderBy: { dueDate: 'asc' },
    });
    return rows.map((bill) => ({
      id: bill.id,
      dueDate: bill.dueDate,
      closingDate: bill.closingDate,
      totalAmount: bill.totalAmount.toFixed(2),
      minimumPayment: bill.minimumPayment?.toFixed(2) ?? null,
      status: bill.status,
    }));
  }
}

export type CardBillView = Prisma.CreditCardBillGetPayload<object> & {
  status: CreditCardBillStatus;
};
