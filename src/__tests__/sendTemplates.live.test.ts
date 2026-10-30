// Live test case for generate_invoice and delivery_confirmation WhatsApp
// templates — calls the app's real sendWhatsAppTemplate() (src/lib/msg91Client.ts)
// directly with sample data, bypassing the full order lifecycle (no real
// order/customer needed, no DB writes). Not part of the normal CI/unit suite.
// Run with:
//   npx tsx src/__tests__/sendTemplates.live.test.ts +91XXXXXXXXXX
import { sendWhatsAppTemplate, resolveWhatsappFrom } from '../lib/msg91Client';
import { MSG91_TEMPLATES } from '../constants/msg91Templates';
import { extractPaymentLinkSuffix } from '../utils/paymentLink';

const DELIVERY_CONFIRMATION_HEADER_IMAGE_URL =
  'https://lljvligcuqolaoxsaeal.supabase.co/storage/v1/object/public/invoices/delivery-confirmation-header.jpeg';

const toPhoneNumber = process.argv[2];
if (!toPhoneNumber) {
  console.error('Usage: npx tsx src/__tests__/sendTemplates.live.test.ts <phoneNumberWithCountryCode>');
  process.exit(1);
}

const fromNumber = resolveWhatsappFrom(null);
const samplePaymentLink = 'https://rzp.io/rzp/TESTSUFFIX';

const run = async () => {
  console.log(`Sending from ${fromNumber} to ${toPhoneNumber}...`);

  try {
    await sendWhatsAppTemplate({
      toPhoneNumber,
      fromNumber,
      templateName: MSG91_TEMPLATES.invoiceReady.name,
      language: MSG91_TEMPLATES.invoiceReady.language,
      bodyVariables: ['Test Customer', 'PB-TEST-001', '499'],
      buttonUrlParam: extractPaymentLinkSuffix(samplePaymentLink),
    });
    console.log('PASS: generate_invoice sent');
  } catch (err) {
    console.error('FAIL: generate_invoice', err);
  }

  try {
    await sendWhatsAppTemplate({
      toPhoneNumber,
      fromNumber,
      templateName: MSG91_TEMPLATES.deliveryConfirmation.name,
      language: MSG91_TEMPLATES.deliveryConfirmation.language,
      bodyVariables: ['Test Customer', 'PB-TEST-001', '499'],
      buttonUrlParam: extractPaymentLinkSuffix(samplePaymentLink),
      headerMediaUrl: DELIVERY_CONFIRMATION_HEADER_IMAGE_URL,
      headerType: 'image',
    });
    console.log('PASS: delivery_confirmation sent');
  } catch (err) {
    console.error('FAIL: delivery_confirmation', err);
  }
};

run();
