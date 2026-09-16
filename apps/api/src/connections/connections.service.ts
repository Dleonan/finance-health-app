import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataProvider } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PluggyClientService } from '../integrations/pluggy/pluggy.client';
import { SyncQueueService } from '../sync/sync-queue.service';
import type { CompleteConnectionDto } from './dto/complete-connection.dto';

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pluggy: PluggyClientService,
    private readonly queue: SyncQueueService,
  ) {}

  list(userId: string) {
    return this.prisma.connection.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        provider: true,
        institution: true,
        status: true,
        lastSyncedAt: true,
        lastErrorAt: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async createToken(userId: string) {
    return this.pluggy.createConnectToken(undefined, userId);
  }

  async reconnectToken(userId: string, connectionId: string) {
    const connection = await this.prisma.connection.findFirst({
      where: { id: connectionId, userId, provider: DataProvider.PLUGGY },
    });
    if (!connection) throw new NotFoundException('Connection not found');
    return this.pluggy.createConnectToken(connection.providerItemId, userId);
  }

  async complete(userId: string, dto: CompleteConnectionDto) {
    const existing = await this.prisma.connection.findUnique({
      where: {
        provider_providerItemId: {
          provider: DataProvider.PLUGGY,
          providerItemId: dto.providerItemId,
        },
      },
    });
    if (existing && existing.userId !== userId)
      throw new ConflictException('Provider item already linked');

    const connection = await this.prisma.connection.upsert({
      where: {
        provider_providerItemId: {
          provider: DataProvider.PLUGGY,
          providerItemId: dto.providerItemId,
        },
      },
      create: {
        userId,
        provider: DataProvider.PLUGGY,
        providerItemId: dto.providerItemId,
        institution: dto.institution,
        status: 'PENDING',
      },
      update: {
        institution: dto.institution,
        status: 'PENDING',
        lastErrorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    await this.queue.enqueue(connection.id, { triggerEventType: 'item/created' });
    return { id: connection.id, status: connection.status };
  }

  async remove(userId: string, connectionId: string) {
    const result = await this.prisma.connection.deleteMany({ where: { id: connectionId, userId } });
    if (result.count === 0) throw new NotFoundException('Connection not found');
    return { success: true };
  }
}
