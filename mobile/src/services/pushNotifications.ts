import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiRequest } from '../api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Requests permission, gets an Expo push token, and registers it with the
// backend. Called once a user is signed in (see App.tsx) — no-ops quietly on
// simulators/emulators (push tokens require a physical device) and if
// permission is denied, since this is a supporting feature, not a blocker.
export const registerForPushNotifications = async (): Promise<void> => {
  if (!Device.isDevice) {
    return;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return;
  }

  // Requires an EAS project id (app.json -> extra.eas.projectId) once this
  // app has been through `eas init` — not yet configured in this project,
  // so this call will throw until that account-level setup happens.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

  await apiRequest('/api/v1/devices', {
    method: 'POST',
    body: { expoPushToken: tokenResponse.data, platform: Platform.OS },
  });
};
