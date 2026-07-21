jest.mock('twilio', () => jest.fn(() => ({ messages: { create: jest.fn() } })));

import { formatTwilioError } from '../lib/twilioClient';

describe('formatTwilioError', () => {
  it('formats a Twilio RestException with code, message, and moreInfo', () => {
    const twilioErr = { code: 21608, message: 'The number is unverified.', moreInfo: 'https://www.twilio.com/docs/errors/21608' };

    expect(formatTwilioError(twilioErr)).toBe(
      'Twilio error 21608: The number is unverified. (https://www.twilio.com/docs/errors/21608)'
    );
  });

  it('formats a Twilio error without moreInfo', () => {
    const twilioErr = { code: 21211, message: 'Invalid \'To\' Phone Number' };

    expect(formatTwilioError(twilioErr)).toBe("Twilio error 21211: Invalid 'To' Phone Number");
  });

  it('falls back to a plain Error message when there is no Twilio code', () => {
    expect(formatTwilioError(new Error('network timeout'))).toBe('network timeout');
  });

  it('falls back to String() for a non-Error, non-Twilio-shaped rejection', () => {
    expect(formatTwilioError('something went wrong')).toBe('something went wrong');
  });
});
