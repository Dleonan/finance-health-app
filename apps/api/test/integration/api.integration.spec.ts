import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';

jest.mock('pluggy-sdk', () => ({
  PluggyClient: class {
    fetchItem() {
      return Promise.reject(new Error('provider disabled in integration test'));
    }
  },
}));

const maybeDescribe = process.env.DATABASE_URL ? describe : describe.skip;

maybeDescribe('API integration', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule);
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves readiness and requires webhook authentication', async () => {
    const ready = await fetch(`${baseUrl}/v1/health/ready`);
    expect(ready.status).toBe(200);

    const webhook = await fetch(`${baseUrl}/v1/webhooks/pluggy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: 'integration-missing-secret', event: 'item/updated' }),
    });
    expect(webhook.status).toBe(401);
  });

  it('registers a user, serves a real dashboard and rejects unverifiable provider items', async () => {
    const suffix = randomUUID();
    const register = await fetch(`${baseUrl}/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `integration-${suffix}@example.com`,
        password: 'IntegrationPass123!',
      }),
    });
    expect(register.status).toBe(201);
    const auth = (await register.json()) as { accessToken: string };
    expect(auth.accessToken).toBeTruthy();

    const dashboard = await fetch(`${baseUrl}/v1/dashboard/today`, {
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(dashboard.status).toBe(200);
    const dashboardBody = (await dashboard.json()) as {
      financialHealth: { score: number | null; status: string };
    };
    expect(dashboardBody.financialHealth.score).toBeNull();
    expect(dashboardBody.financialHealth.status).toBe('INSUFFICIENT_DATA');
    expect(dashboardBody).toMatchObject({
      availableCash: null,
      investments: null,
      liabilities: null,
      netWorth: null,
      dataQuality: 'UNAVAILABLE',
    });

    const connection = await fetch(`${baseUrl}/v1/connections/pluggy/complete`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ providerItemId: `item-${suffix}` }),
    });
    expect(connection.status).toBe(403);
  });
});
