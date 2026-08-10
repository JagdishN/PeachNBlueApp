const communicationLogCreateMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: { communicationLog: { create: (...args: unknown[]) => communicationLogCreateMock(...args) } },
}));

const sendWhatsAppTemplateMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/msg91Client', () => ({
  sendWhatsAppTemplate: (...args: unknown[]) => sendWhatsAppTemplateMock(...args),
  formatMsg91Error: (err: unknown) => String(err),
  resolveWhatsappFrom: (branchWhatsappNumber: string | null | undefined) => branchWhatsappNumber ?? '919999999999',
}));

import { sendNotification, notifyAdminsOfPickup } from '../services/notificationService';

beforeEach(() => {
  sendWhatsAppTemplateMock.mockReset().mockResolvedValue(undefined);
  communicationLogCreateMock.mockReset().mockResolvedValue(undefined);
});

// CLAUDE.md "Branches": each branch sends WhatsApp from its own registered
// number — sendNotification resolves this off customer.branch, not a
// hardcoded shared sender, and falls back only when the branch has none.
describe('sendNotification', () => {
  const customer = {
    id: 'customer-1',
    phoneNumber: '9000000001',
    whatsappNumber: null,
    branch: { whatsappNumber: '919398125151' },
  };
  const template = { name: 'pb_pickup_confirmation', bodyVariables: ['PB-ABC1', '450'] };

  it('sends the template WhatsApp message from the customer\'s branch number', async () => {
    await sendNotification(customer, 'pickup_confirmation', template);

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith({
      toPhoneNumber: '9000000001',
      fromNumber: '919398125151',
      templateName: 'pb_pickup_confirmation',
      bodyVariables: ['PB-ABC1', '450'],
      headerMediaUrl: undefined,
    });
  });

  it('falls back to the shared number when the branch has none configured', async () => {
    await sendNotification({ ...customer, branch: { whatsappNumber: null } }, 'pickup_confirmation', template);

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({ fromNumber: '919999999999' })
    );
  });

  it('logs a "sent" communications_log row on success', async () => {
    await sendNotification(customer, 'pickup_confirmation', template, 'order-1');

    expect(communicationLogCreateMock).toHaveBeenCalledWith({
      data: { customerId: 'customer-1', orderId: 'order-1', messageType: 'pickup_confirmation', channel: 'whatsapp', status: 'sent' },
    });
  });

  it('logs a "failed" communications_log row and does not throw when the send fails', async () => {
    sendWhatsAppTemplateMock.mockRejectedValue(new Error('MSG91 error 400: Invalid template'));

    await expect(sendNotification(customer, 'pickup_confirmation', template)).resolves.toBeUndefined();

    expect(communicationLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
  });
});

// CLAUDE.md order workflow item 4a: admin WhatsApp notification on pickup —
// internal, WhatsApp-only, no communications_log row, one send per admin,
// a failed send for one admin must not stop the others.
describe('notifyAdminsOfPickup', () => {
  const template = { name: 'pb_admin_pickup_notification', bodyVariables: ['A-101', 'PB-ABC1', '450'] };

  it('sends a WhatsApp template to every admin from the given fromNumber', async () => {
    await notifyAdminsOfPickup(
      [
        { id: 'admin-1', phoneNumber: '9000000010' },
        { id: 'admin-2', phoneNumber: '9000000011' },
      ],
      template,
      '919398125151'
    );

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith({
      toPhoneNumber: '9000000010',
      fromNumber: '919398125151',
      templateName: 'pb_admin_pickup_notification',
      bodyVariables: ['A-101', 'PB-ABC1', '450'],
    });
    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith({
      toPhoneNumber: '9000000011',
      fromNumber: '919398125151',
      templateName: 'pb_admin_pickup_notification',
      bodyVariables: ['A-101', 'PB-ABC1', '450'],
    });
  });

  it('never writes to communications_log (customer-scoped table, not for internal admin notices)', async () => {
    await notifyAdminsOfPickup([{ id: 'admin-1', phoneNumber: '9000000010' }], template, '919398125151');

    expect(communicationLogCreateMock).not.toHaveBeenCalled();
  });

  it('does not throw when one admin\'s send fails, and still sends to the rest', async () => {
    sendWhatsAppTemplateMock.mockRejectedValueOnce(new Error('MSG91 error 400'));

    await expect(
      notifyAdminsOfPickup(
        [
          { id: 'admin-1', phoneNumber: '9000000010' },
          { id: 'admin-2', phoneNumber: '9000000011' },
        ],
        template,
        '919398125151'
      )
    ).resolves.toBeUndefined();

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledTimes(2);
  });
});
