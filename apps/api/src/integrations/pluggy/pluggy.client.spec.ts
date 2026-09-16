import {
  PluggyClientService,
  PluggyItemOwnershipError,
  PluggyProviderUnavailableError,
} from './pluggy.client';

describe('PluggyClientService item ownership verification', () => {
  const makeService = (fetchItem: jest.Mock) => {
    const service = new PluggyClientService({} as never);
    service['client'] = { fetchItem } as never;
    return service;
  };

  it('returns ownership error only when the provider confirms another owner', async () => {
    const service = makeService(
      jest.fn().mockResolvedValue({ id: 'item-1', clientUserId: 'user-B' }),
    );

    await expect(service.verifyItemOwnership('item-1', 'user-A')).rejects.toBeInstanceOf(
      PluggyItemOwnershipError,
    );
  });

  it('keeps provider 503 separate from ownership failures', async () => {
    const service = makeService(jest.fn().mockRejectedValue({ statusCode: 503 }));

    await expect(service.verifyItemOwnership('item-1', 'user-A')).rejects.toMatchObject({
      name: 'PluggyProviderUnavailableError',
      statusCode: 503,
    });
    await expect(service.verifyItemOwnership('item-1', 'user-A')).rejects.not.toBeInstanceOf(
      PluggyItemOwnershipError,
    );
  });

  it('keeps network failures separate from ownership failures', async () => {
    const service = makeService(jest.fn().mockRejectedValue(new Error('timeout')));

    await expect(service.verifyItemOwnership('item-1', 'user-A')).rejects.toBeInstanceOf(
      PluggyProviderUnavailableError,
    );
    await expect(service.verifyItemOwnership('item-1', 'user-A')).rejects.not.toBeInstanceOf(
      PluggyItemOwnershipError,
    );
  });
});
