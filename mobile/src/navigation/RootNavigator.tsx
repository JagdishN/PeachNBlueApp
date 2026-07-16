import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/shared/LoginScreen';
import { StaffStack } from './StaffStack';
import { AdminStack } from './AdminStack';

export type RootStackParamList = {
  Login: undefined;
  StaffStack: undefined;
  AdminStack: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Only reached once App.tsx has resolved both the splash timer and the
// stored-auth-token restore, so `state.status` here is never 'loading'.
export const RootNavigator: React.FC = () => {
  const { state } = useAuth();
  const isSignedIn = state.status === 'signedIn';
  const role = state.status === 'signedIn' ? state.user.role : null;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isSignedIn ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : role === 'admin' ? (
        <Stack.Screen name="AdminStack" component={AdminStack} />
      ) : (
        <Stack.Screen name="StaffStack" component={StaffStack} />
      )}
    </Stack.Navigator>
  );
};
