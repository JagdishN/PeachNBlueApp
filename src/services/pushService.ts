import prisma from '../prisma/client';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Uses Expo's push service (itself backed by FCM on Android / APNs on iOS)
// rather than the raw Firebase Admin SDK — this is the standard approach for
// a managed Expo app and needs no native credentials beyond the push token
// itself. The FIREBASE_* env vars already scaffolded in .env.example are not
// used by this path.
const sendToTokens = async (tokens: string[], title: string, body: string, data?: Record<string, unknown>) => {
  if (tokens.length === 0) return;

  const messages = tokens.map((to) => ({ to, title, body, data }));

  try {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error('Failed to send push notification:', err);
  }
};

export const sendToUser = async (userId: string, title: string, body: string, data?: Record<string, unknown>) => {
  const devices = await prisma.deviceToken.findMany({ where: { userId } });
  await sendToTokens(devices.map((d) => d.expoPushToken), title, body, data);
};

export const sendToUsers = async (userIds: string[], title: string, body: string, data?: Record<string, unknown>) => {
  if (userIds.length === 0) return;
  const devices = await prisma.deviceToken.findMany({ where: { userId: { in: userIds } } });
  await sendToTokens(devices.map((d) => d.expoPushToken), title, body, data);
};
