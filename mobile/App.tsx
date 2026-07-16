import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import {
  useFonts as useLoraFonts,
  Lora_600SemiBold,
  Lora_600SemiBold_Italic,
  Lora_700Bold,
} from '@expo-google-fonts/lora';
import {
  useFonts as useInterFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { navigationRef, navigateToOrder } from './src/navigation/navigationRef';
import { SplashScreen } from './src/screens/shared/SplashScreen';
import { registerForPushNotifications } from './src/services/pushNotifications';

const SPLASH_DURATION_MS = 2000;

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

// Shown on EVERY cold start, not just first install — CLAUDE.md is explicit
// this is not a one-time onboarding splash. Deliberately no persisted
// "have I shown this before" flag anywhere here. Stays up until fonts have
// loaded, the 2-second timer has elapsed, AND the stored-auth-token restore
// has resolved — whichever finishes last.
function AppContent() {
  const { state } = useAuth();
  const [loraLoaded] = useLoraFonts({ Lora_600SemiBold, Lora_600SemiBold_Italic, Lora_700Bold });
  const [interLoaded] = useInterFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  const [splashElapsed, setSplashElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSplashElapsed(true), SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  // Registers (or re-registers) this device for push on every transition
  // into a signed-in state — covers both a fresh sign-in and a restored
  // session on reopen. Best-effort: a denied permission or missing EAS
  // project id shouldn't block anything else in the app.
  useEffect(() => {
    if (state.status === 'signedIn') {
      registerForPushNotifications().catch((err) => console.warn('Push registration failed:', err));
    }
  }, [state.status]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const orderId = response.notification.request.content.data?.orderId as string | undefined;
      if (orderId) {
        navigateToOrder(orderId);
      }
    });
    return () => subscription.remove();
  }, []);

  const fontsReady = loraLoaded && interLoaded;
  const showSplash = !fontsReady || !splashElapsed || state.status === 'loading';

  if (showSplash) {
    return (
      <>
        <StatusBar style="dark" />
        <SplashScreen />
      </>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <StatusBar style="dark" />
      <RootNavigator />
    </NavigationContainer>
  );
}
