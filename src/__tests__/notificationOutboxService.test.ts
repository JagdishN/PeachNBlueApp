import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

const sendWhatsAppTemplateMock = jest.fn();
jest.mock('../lib/msg91Client', () => ({
  sendWhatsAppTemplate: (...args: unknown[]) => sendWhatsAppTemplateMock(...args),
  formatMsg91Error: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import prisma from '../prisma/client';
import { enqueueFailedSend, processNotificationOutbox } from '../services/notificationOutboxService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
  sendWhatsAppTemplateMock.mockReset();
});

describe('enqueueFailedSend', () => {
  it('persists every field needed for a faithful retry', async () => {
    await enqueueFailedSend({
      customerId: 'customer-1',
      recipientPhoneNumber: '9000000001',
      fromNumber: '919398125151',
      templateName: 'payment_receipt',
      templateLanguage: 'en',
      bodyVariables: ['Test Customer', '400', 'PB-TEST', 'Cash'],
      buttonUrlParam: 'AbCd1234',
      headerMediaUrl: 'https://example.com/img.jpg',
      headerType: 'image',
    });

    expect(prismaMock.notificationOutbox.create).toHaveBeenCalledWith({
      data: {
        customerId: 'customer-1',
        recipientPhoneNumber: '9000000001',
        fromNumber: '919398125151',
        templateName: 'payment_receipt',
        templateLanguage: 'en',
        bodyVariables: ['Test Customer', '400', 'PB-TEST', 'Cash'],
        buttonUrlParam: 'AbCd1234',
        headerMediaUrl: 'https://example.com/img.jpg',
        headerType: 'image',
        status: 'pending',
      },
    });
  });
});

describe('processNotificationOutbox', () => {
  it('deletes the row on a successful retry', async () => {
    prismaMock.notificationOutbox.findMany.mockResolvedValue([
      { id: 'row-1', recipientPhoneNumber: '9000000001', fromNumber: '919398125151', templateName: 'payment_receipt', templateLanguage: 'en', bodyVariables: ['a'], buttonUrlParam: null, headerMediaUrl: null, headerType: null, attempts: 0 },
    ] as any);
    sendWhatsAppTemplateMock.mockResolvedValue(undefined);
    prismaMock.notificationOutbox.count.mockResolvedValue(0);

    const result = await processNotificationOutbox();

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({ toPhoneNumber: '9000000001', templateName: 'payment_receipt' })
    );
    expect(prismaMock.notificationOutbox.delete).toHaveBeenCalledWith({ where: { id: 'row-1' } });
    expect(result.sent).toBe(1);
  });

  it('increments attempts and schedules a later retry on a failure below the max', async () => {
    prismaMock.notificationOutbox.findMany.mockResolvedValue([
      { id: 'row-1', recipientPhoneNumber: '9000000001', fromNumber: '919398125151', templateName: 'payment_receipt', templateLanguage: 'en', bodyVariables: ['a'], buttonUrlParam: null, headerMediaUrl: null, headerType: null, attempts: 0 },
    ] as any);
    sendWhatsAppTemplateMock.mockRejectedValue(new Error('MSG91 error 500'));
    prismaMock.notificationOutbox.count.mockResolvedValue(1);

    const result = await processNotificationOutbox();

    expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'row-1' }, data: expect.objectContaining({ attempts: 1, lastError: 'MSG91 error 500' }) })
    );
    expect(prismaMock.notificationOutbox.delete).not.toHaveBeenCalled();
    expect(result.stillPending).toBe(1);
  });

  it('abandons (does not delete) a row that has failed MAX_ATTEMPTS times', async () => {
    prismaMock.notificationOutbox.findMany.mockResolvedValue([
      { id: 'row-1', recipientPhoneNumber: '9000000001', fromNumber: '919398125151', templateName: 'payment_receipt', templateLanguage: 'en', bodyVariables: ['a'], buttonUrlParam: null, headerMediaUrl: null, headerType: null, attempts: 4 },
    ] as any);
    sendWhatsAppTemplateMock.mockRejectedValue(new Error('MSG91 error 500'));
    prismaMock.notificationOutbox.count.mockResolvedValue(0);

    const result = await processNotificationOutbox();

    expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'row-1' }, data: expect.objectContaining({ status: 'abandoned', attempts: 5 }) })
    );
    expect(prismaMock.notificationOutbox.delete).not.toHaveBeenCalled();
    expect(result.abandoned).toBe(1);
  });

  it('only queries rows whose nextRetryAt has passed, status pending', async () => {
    prismaMock.notificationOutbox.findMany.mockResolvedValue([]);
    prismaMock.notificationOutbox.count.mockResolvedValue(0);

    await processNotificationOutbox();

    expect(prismaMock.notificationOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending', nextRetryAt: { lte: expect.any(Date) } } })
    );
  });
});
