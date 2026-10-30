import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

const sendWhatsAppTemplateMock = jest.fn();
jest.mock('../lib/msg91Client', () => ({
  sendWhatsAppTemplate: (...args: unknown[]) => sendWhatsAppTemplateMock(...args),
  formatMsg91Error: (err: unknown) => String(err),
  resolveWhatsappFrom: (branchWhatsappNumber: string | null | undefined) => branchWhatsappNumber ?? '919999999999',
}));

import prisma from '../prisma/client';
import { sendPaymentReminder, listReminderHistory } from '../services/reminderService';
import { MSG91_TEMPLATES } from '../constants/msg91Templates';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const CUSTOMER = {
  id: 'customer-1',
  fullName: 'Test Customer',
  phoneNumber: '9000000001',
  alternativePhoneNumber: null,
  secondaryPhoneNumber: null,
  branch: { whatsappNumber: '917013725151' },
};

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.invoiceAdjustment.findMany.mockResolvedValue([]);
  sendWhatsAppTemplateMock.mockReset().mockResolvedValue({ messageId: 'msg-1' });
  prismaMock.customer.findUnique.mockResolvedValue(CUSTOMER as any);
  prismaMock.payment.findFirst.mockResolvedValue(null); // no pending UPI by default
  prismaMock.paymentReminderLog.findFirst.mockResolvedValue(null); // no recent reminder by default
  prismaMock.paymentReminderLog.create.mockResolvedValue({ id: 'reminder-1' } as any);
  // getCustomerOutstandingSummary's own reads.
  prismaMock.invoice.findMany.mockResolvedValue([
    { id: 'inv-1', orderId: 'order-1', amount: 100, dueDate: new Date('2026-11-05'), createdAt: new Date('2026-11-01'), order: { orderNumber: 'PB-001' } },
    { id: 'inv-2', orderId: 'order-2', amount: 200, dueDate: new Date('2026-11-09'), createdAt: new Date('2026-11-05'), order: { orderNumber: 'PB-002' } },
  ] as any);
  prismaMock.invoice.findUnique.mockImplementation(((args: any) => {
    const amounts: Record<string, number> = { 'inv-1': 100, 'inv-2': 200 };
    return Promise.resolve({ id: args.where.id, amount: amounts[args.where.id] } as any);
  }) as any);
  prismaMock.payment.findMany.mockResolvedValue([]); // nothing paid -> full outstanding on both
});

describe('sendPaymentReminder', () => {
  it('404s when the customer does not exist', async () => {
    prismaMock.customer.findUnique.mockResolvedValue(null);
    await expect(sendPaymentReminder({ customerId: 'missing', adminId: 'admin-1' })).rejects.toMatchObject({ status: 404 });
  });

  // Mandatory test #12: reminder for one invoice.
  it('sends a reminder for a single specified invoice, with that invoice\'s own outstanding as the total', async () => {
    const result = await sendPaymentReminder({ customerId: 'customer-1', adminId: 'admin-1', invoiceIds: ['inv-1'] });

    expect(result.outstandingAtSend).toBe(100);
    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toPhoneNumber: '9000000001',
        templateName: MSG91_TEMPLATES.paymentReminder.name,
        bodyVariables: ['Test Customer', '100'],
      })
    );
    expect(prismaMock.paymentReminderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceIds: ['inv-1'], outstandingAtSendPaise: 10000n }) })
    );
  });

  // Mandatory test #13: reminder for multiple invoices (the combined case —
  // no invoiceIds given means every currently-outstanding invoice).
  it('sends a combined reminder for every outstanding invoice when none is specified', async () => {
    const result = await sendPaymentReminder({ customerId: 'customer-1', adminId: 'admin-1' });

    expect(result.outstandingAtSend).toBe(300);
    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith(expect.objectContaining({ bodyVariables: ['Test Customer', '300'] }));
    expect(prismaMock.paymentReminderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceIds: ['inv-1', 'inv-2'] }) })
    );
  });

  it('400s when there is nothing currently outstanding to remind about', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 10000n, allocatedPaise: 10000n },
    ] as any);
    // Both invoices fully paid in this scenario — simplify by returning
    // empty candidates instead.
    prismaMock.invoice.findMany.mockResolvedValue([]);

    await expect(sendPaymentReminder({ customerId: 'customer-1', adminId: 'admin-1' })).rejects.toMatchObject({ status: 400 });
    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled();
  });

  // Mandatory test #17: pending UPI verification prevents an inaccurate reminder.
  it('blocks the reminder when a bank_upi report for a targeted invoice is still pending verification', async () => {
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'payment-1', paymentSource: 'bank_upi', verificationStatus: 'pending' } as any);

    await expect(sendPaymentReminder({ customerId: 'customer-1', adminId: 'admin-1' })).rejects.toMatchObject({
      status: 409,
      code: 'PENDING_VERIFICATION',
    });
    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled();
  });

  // Mandatory test #16: duplicate reminder warning.
  it('blocks a reminder sent within the last 24 hours unless explicitly overridden', async () => {
    prismaMock.paymentReminderLog.findFirst.mockResolvedValue({ id: 'reminder-0', sentAt: new Date() } as any);

    await expect(sendPaymentReminder({ customerId: 'customer-1', adminId: 'admin-1' })).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_REMINDER',
    });
    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled();
  });

  it('allows a duplicate-window reminder through when explicitly overridden', async () => {
    prismaMock.paymentReminderLog.findFirst.mockResolvedValue({ id: 'reminder-0', sentAt: new Date() } as any);

    await expect(
      sendPaymentReminder({ customerId: 'customer-1', adminId: 'admin-1', overrideDuplicateWarning: true })
    ).resolves.toBeDefined();
    expect(sendWhatsAppTemplateMock).toHaveBeenCalled();
  });

  // Mandatory test #22: a failed WhatsApp send still retains an accurate
  // audit status (not silently reported as "sent").
  it('logs deliveryStatus "failed" (not "sent") when every recipient send fails', async () => {
    sendWhatsAppTemplateMock.mockRejectedValue(new Error('MSG91 error 400'));

    const result = await sendPaymentReminder({ customerId: 'customer-1', adminId: 'admin-1' });

    expect(result.deliveryStatus).toBe('failed');
    expect(prismaMock.paymentReminderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: 'failed', providerMessageIds: [''] }) })
    );
  });

  it('logs deliveryStatus "partial" when one of several recipients fails but another succeeds', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({
      ...CUSTOMER,
      alternativePhoneNumber: '9000000002',
    } as any);
    sendWhatsAppTemplateMock.mockResolvedValueOnce({ messageId: 'msg-1' }).mockRejectedValueOnce(new Error('MSG91 error 400'));

    const result = await sendPaymentReminder({ customerId: 'customer-1', adminId: 'admin-1' });

    expect(result.deliveryStatus).toBe('partial');
  });

  it('records the admin who sent it', async () => {
    await sendPaymentReminder({ customerId: 'customer-1', adminId: 'admin-42' });

    expect(prismaMock.paymentReminderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sentById: 'admin-42' }) })
    );
  });
});

describe('listReminderHistory', () => {
  it('lists reminders for the customer, most recent first', async () => {
    prismaMock.paymentReminderLog.findMany.mockResolvedValue([] as any);

    await listReminderHistory('customer-1');

    expect(prismaMock.paymentReminderLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'customer-1' }, orderBy: { sentAt: 'desc' } })
    );
  });
});
