import { AccountsService } from './accounts.service';

describe('AccountsService ownership', () => {
  it('always scopes account lookup through the connection owner', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new AccountsService({ account: { findFirst } } as never);
    await expect(service.get('user-b', 'account-a')).rejects.toThrow('Account not found');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'account-a', connection: { userId: 'user-b' } } }),
    );
  });
});
