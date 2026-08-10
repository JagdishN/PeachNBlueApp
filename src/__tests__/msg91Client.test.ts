const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

jest.mock('../config', () => ({
  MSG91_AUTH_KEY: 'authkey_test',
  // The shared fallback sender — CLAUDE.md "Branches": used only when a
  // branch has no WhatsApp number of its own configured yet.
  MSG91_INTEGRATED_NUMBER: '919999999999',
}));

import { formatMsg91Error, sendWhatsAppTemplate, resolveWhatsappFrom } from '../lib/msg91Client';

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe('formatMsg91Error', () => {
  it('formats an error carrying an MSG91 code', () => {
    expect(formatMsg91Error({ code: '400', message: 'Invalid template name' })).toBe(
      'MSG91 error 400: Invalid template name'
    );
  });

  it('falls back to a plain Error message when there is no code', () => {
    expect(formatMsg91Error(new Error('network timeout'))).toBe('network timeout');
  });

  it('falls back to String() for a non-Error, non-MSG91-shaped rejection', () => {
    expect(formatMsg91Error('something went wrong')).toBe('something went wrong');
  });
});

// CLAUDE.md "Branches": each branch sends WhatsApp from its own registered
// number, passed in explicitly by the caller.
describe('sendWhatsAppTemplate', () => {
  it('POSTs to the MSG91 WhatsApp endpoint with the authkey header and composed body', async () => {
    await sendWhatsAppTemplate({
      toPhoneNumber: '919000000001',
      fromNumber: '919398125151',
      templateName: 'pb_otp_login',
      bodyVariables: ['654321'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authkey: 'authkey_test', 'Content-Type': 'application/json' }),
      })
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.integrated_number).toBe('919398125151');
    expect(body.payload.template.name).toBe('pb_otp_login');
    expect(body.payload.template.to_and_components[0].to).toEqual(['919000000001']);
    expect(body.payload.template.to_and_components[0].components).toEqual({
      body_1: { type: 'text', value: '654321' },
    });
  });

  it('maps multiple bodyVariables to body_1, body_2, ... in order', async () => {
    await sendWhatsAppTemplate({
      toPhoneNumber: '919000000001',
      fromNumber: '919398125151',
      templateName: 'pb_amount_revision',
      bodyVariables: ['PB-ABC1', '450', 'Stain removal needed'],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.payload.template.to_and_components[0].components).toEqual({
      body_1: { type: 'text', value: 'PB-ABC1' },
      body_2: { type: 'text', value: '450' },
      body_3: { type: 'text', value: 'Stain removal needed' },
    });
  });

  it('adds a header_1 document component when headerMediaUrl is given', async () => {
    await sendWhatsAppTemplate({
      toPhoneNumber: '919000000001',
      fromNumber: '919398125151',
      templateName: 'pb_invoice_ready',
      bodyVariables: ['PB-ABC1', '450', 'Pay online: https://rzp.io/l/x'],
      headerMediaUrl: 'https://storage.example/invoice.pdf',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.payload.template.to_and_components[0].components.header_1).toEqual({
      type: 'document',
      value: 'https://storage.example/invoice.pdf',
    });
  });

  it('throws with the response status/message when MSG91 returns a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Invalid template' }) });

    await expect(
      sendWhatsAppTemplate({
        toPhoneNumber: '919000000001',
        fromNumber: '919398125151',
        templateName: 'nonexistent',
        bodyVariables: [],
      })
    ).rejects.toMatchObject({ message: 'Invalid template', code: '400' });
  });
});

describe('resolveWhatsappFrom', () => {
  it('uses the branch\'s own WhatsApp number when set', () => {
    expect(resolveWhatsappFrom('919398125151')).toBe('919398125151');
  });

  it('falls back to the shared MSG91_INTEGRATED_NUMBER when the branch has none configured', () => {
    expect(resolveWhatsappFrom(null)).toBe('919999999999');
    expect(resolveWhatsappFrom(undefined)).toBe('919999999999');
  });
});
