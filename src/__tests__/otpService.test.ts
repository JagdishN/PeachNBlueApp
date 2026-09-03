const sendWhatsAppTemplateMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/msg91Client', () => ({
  sendWhatsAppTemplate: (...args: unknown[]) => sendWhatsAppTemplateMock(...args),
  formatMsg91Error: (err: unknown) => String(err),
  resolveWhatsappFrom: () => '917013725151',
}));

import { sendOtpViaChannels } from '../services/otpService';
import { MSG91_TEMPLATES } from '../constants/msg91Templates';

beforeEach(() => {
  sendWhatsAppTemplateMock.mockReset().mockResolvedValue(undefined);
});

// Real bug found and fixed 2026-09-02 ("Live send verification"): every OTP
// test send returned MSG91 status: "success" but nothing arrived. Root
// causes were the wrong language code (hardcoded "en" instead of
// account_login's real approved "en_US") and the missing mandatory OTP
// "Copy Code" button component (account_login's real template definition
// has a BUTTONS component whose {{1}} is the OTP code itself, confirmed by
// pulling the template directly from MSG91) — this locks both fixes in.
describe('sendOtpViaChannels', () => {
  it('sends the OTP template with the real approved language and the OTP code as both the body variable and the button param', async () => {
    await sendOtpViaChannels('919000000001', '482913');

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith({
      toPhoneNumber: '919000000001',
      fromNumber: '917013725151',
      templateName: MSG91_TEMPLATES.otpLogin.name,
      language: MSG91_TEMPLATES.otpLogin.language,
      bodyVariables: ['482913'],
      buttonUrlParam: '482913',
    });
  });

  it('does not throw when the send fails — OTP delivery failure must not break the request-otp flow', async () => {
    sendWhatsAppTemplateMock.mockRejectedValue(new Error('MSG91 error 400'));

    await expect(sendOtpViaChannels('919000000001', '482913')).resolves.toBeUndefined();
  });
});
