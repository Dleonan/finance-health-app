import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class LoansService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.loan.findMany({
      where: { connection: { userId } },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      currency: row.currency,
      principal: row.principal?.toFixed(2) ?? null,
      outstandingBalance: row.outstandingBalance?.toFixed(2) ?? null,
      installment: row.installment?.toFixed(2) ?? null,
      interestRate: row.interestRate?.toFixed(6) ?? null,
      nextDueDate: row.nextDueDate,
      remainingInstallments: row.remainingInstallments,
    }));
  }
}
