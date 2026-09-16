import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class InvestmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.investment.findMany({
      where: { connection: { userId } },
      include: { snapshots: { orderBy: { snapshotAt: 'desc' }, take: 1 } },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      balance: row.snapshots[0]?.balance.toFixed(2) ?? '0.00',
      snapshotAt: row.snapshots[0]?.snapshotAt ?? null,
    }));
  }
}
