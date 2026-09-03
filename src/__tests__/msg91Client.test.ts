const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

jest.mock('../config', () => ({
  MSG91_AUTH_KEY: 'authkey_test',
  // The shared fallback sender — CLAUDE.md "Branches": used only when a
  // branch has no WhatsApp number of its own configured yet.
  MSG91_INTEGRATED_NUMBER: '919999999999',
  MSG91_WABA_NAMESPACE: 'namespace_test',
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

    // Regression guard (2026-09-02): the endpoint WITHOUT /bulk/ silently
    // accepts requests (status: "success") but never dispatches them — this
    // shipped for the entire life of this integration until caught against
    // a real, authoritative MSG91 doc cURL example for account_login.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authkey: 'authkey_test', 'Content-Type': 'application/json' }),
      })
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.integrated_number).toBe('919398125151');
    // A top-level payload.to was added, then removed again — it turned out
    // to only be required by the WRONG (non-/bulk/) endpoint above; the
    // real documented request for the working endpoint has no such field,
    // only the nested to_and_components[].to asserted below.
    expect(body.payload.to).toBeUndefined();
    // Regression guard (2026-09-02, "Live send verification — namespace
    // fix"): a real dashboard-composed send that DID deliver included this;
    // an otherwise-identical API call without it returned MSG91 status:
    // "success" but never actually delivered.
    expect(body.payload.template.namespace).toBe('namespace_test');
    expect(body.payload.template.name).toBe('pb_otp_login');
    expect(body.payload.template.to_and_components[0].to).toEqual(['919000000001']);
    expect(body.payload.template.to_and_components[0].components).toEqual({
      body_1: { type: 'text', value: '654321' },
    });
  });

  // Real bug found 2026-09-03: User.phoneNumber, Customer.phoneNumber, and
  // Branch.whatsappNumber are all stored in the live DB with a literal "+"
  // prefix (needed for authController.ts's exact-string login lookup) — but
  // MSG91's API needs digits-only. Every real send pulled one of these
  // straight into toPhoneNumber/fromNumber with no stripping, meaning real
  // production sends (unlike this session's manually-typed digit-only
  // scratch-script tests) were very likely silently failing on both ends.
  it('strips a leading "+" (and any other non-digit characters) from both toPhoneNumber and fromNumber', async () => {
    await sendWhatsAppTemplate({
      toPhoneNumber: '+91 98850 25151',
      fromNumber: '+917013725151',
      templateName: 'pb_otp_login',
      bodyVariables: ['654321'],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.integrated_number).toBe('917013725151');
    expect(body.payload.template.to_and_components[0].to).toEqual(['919885025151']);
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

  // Uses a generic template name here — this test exercises msg91Client.ts's
  // button_1 mechanic itself, not any specific template's real shape.
  // (invoice_reissued/delivery_confirmation turned out NOT to have a real
  // button component — see msg91Templates.ts; the current real user of this
  // mechanic is account_login's mandatory OTP "Copy Code" button.)
  it('adds a button_1 dynamic-URL component when buttonUrlParam is given', async () => {
    await sendWhatsAppTemplate({
      toPhoneNumber: '919000000001',
      fromNumber: '919398125151',
      templateName: 'some_template_with_a_button',
      bodyVariables: ['Test Customer', 'PB-ABC1', '450'],
      buttonUrlParam: 'https://rzp.io/l/new',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Regression guard (2026-09-02): verified against a real, authoritative
    // MSG91 doc cURL example — type is "text" (not "button"), and value is
    // a plain string (not an array). Every earlier version of this file got
    // both wrong.
    expect(body.payload.template.to_and_components[0].components.button_1).toEqual({
      subtype: 'url',
      type: 'text',
      value: 'https://rzp.io/l/new',
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
