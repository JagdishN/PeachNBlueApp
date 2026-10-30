import 'express-async-errors';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { errorHandler } from '../middleware/errorHandler';
import customerRoutes from '../routes/customers';

jest.mock('../services/outstandingService', () => ({
  getCustomerOutstandingSummary: jest.fn(),
  recordCustomerPayment: jest.fn(),
}));
jest.mock('../services/reminderService', () => ({
  sendPaymentReminder: jest.fn(),
  listReminderHistory: jest.fn(),
}));
jest.mock('../prisma/client', () => ({ __esModule: true, default: {} }));
jest.mock('../services/invoiceReissue.service', () => ({
  reissueAllOpenInvoicesForCustomer: jest.fn(),
}));

import { sendPaymentReminder, listReminderHistory } from '../services/reminderService';

const sendReminderMock = sendPaymentReminder as jest.Mock;
const listHistoryMock = listReminderHistory as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/v1/customers', customerRoutes);
app.use(errorHandler);

const staffToken = jwt.sign({ userId: 'staff-1', role: 'staff', branchId: 'branch-1' }, JWT_SECRET);
const adminToken = jwt.sign({ userId: 'admin-1', role: 'admin', branchId: null }, JWT_SECRET);

beforeEach(() => {
  sendReminderMock.mockReset();
  listHistoryMock.mockReset();
});

describe('POST /api/v1/customers/:id/send-reminder', () => {
  // Mandatory test #15: Staff is rejected by the reminder API.
  it('rejects a staff-role token with 403, never reaching the service', async () => {
    const res = await request(app)
      .post('/api/v1/customers/customer-1/send-reminder')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});

    expect(res.status).toBe(403);
    expect(sendReminderMock).not.toHaveBeenCalled();
  });

  // Mandatory test #14: Admin successfully sends reminder.
  it('allows an admin-role token through to the service', async () => {
    sendReminderMock.mockResolvedValue({
      reminderId: 'reminder-1',
      outstandingAtSend: 300,
      recipientPhoneNumbers: ['9000000001'],
      deliveryStatus: 'sent',
    });

    const res = await request(app)
      .post('/api/v1/customers/customer-1/send-reminder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ invoiceIds: ['inv-1', 'inv-2'] });

    expect(res.status).toBe(200);
    expect(res.body.reminder.deliveryStatus).toBe('sent');
    expect(sendReminderMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'customer-1', adminId: 'admin-1', invoiceIds: ['inv-1', 'inv-2'] })
    );
  });

  it('surfaces a 409 duplicate-reminder warning from the service unchanged', async () => {
    const err = new Error('Already sent within 24h') as Error & { status: number; code: string };
    err.status = 409;
    err.code = 'DUPLICATE_REMINDER';
    sendReminderMock.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/v1/customers/customer-1/send-reminder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(409);
  });
});

describe('GET /api/v1/customers/:id/reminder-history', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .get('/api/v1/customers/customer-1/reminder-history')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });

  // Real bug guard: outstandingAtSendPaise is a BigInt on the raw Prisma
  // row — Express's res.json() throws outright on one, so the controller
  // must convert it to a plain number before responding.
  it('returns the history for an admin, converting outstandingAtSendPaise to a plain number', async () => {
    listHistoryMock.mockResolvedValue([{ id: 'reminder-1', outstandingAtSendPaise: 30000n }]);

    const res = await request(app)
      .get('/api/v1/customers/customer-1/reminder-history')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.history).toEqual([{ id: 'reminder-1', outstandingAtSend: 300 }]);
  });
});
