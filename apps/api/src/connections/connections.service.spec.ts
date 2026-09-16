import { ForbiddenException } from '@nestjs/common';
import { PluggyItemOwnershipError } from '../integrations/pluggy/pluggy.client';
import { ConnectionsService } from './connections.service';

describe('ConnectionsService provider ownership', () => {
  it('does not complete a connection when Pluggy ownership cannot be verified', async () => {
    const verifyItemOwnership = jest.fn().mockRejectedValue(new PluggyItemOwnershipError());
    const service = new ConnectionsService(
      { connection: {} } as never,
      { verifyItemOwnership } as never,
      {} as never,
    );

    await expect(
      service.complete('user-1', { providerItemId: 'item-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(verifyItemOwnership).toHaveBeenCalledWith('item-1', 'user-1');
  });

  it('uses the verified provider institution and queues the initial sync', async () => {
    const verifyItemOwnership = jest
      .fn()
      .mockResolvedValue({ institution: 'Banco Verificado' });
    const upsert = jest.fn().mockResolvedValue({ id: 'connection-1', status: 'PENDING' });
    const service = new ConnectionsService(
      {
        connection: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert,
        },
      } as never,
      { verifyItemOwnership } as never,
      { enqueue: jest.fn().mockResolvedValue({ id: 'run-1' }) } as never,
    );

    await expect(
      service.complete('user-1', {
        providerItemId: 'item-1',
        institution: 'Instituição enviada pelo app',
      }),
    ).resolves.toEqual({ id: 'connection-1', status: 'PENDING' });
    expect(upsert.mock.calls[0][0].create.institution).toBe('Banco Verificado');
  });
});
