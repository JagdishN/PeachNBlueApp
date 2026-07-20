import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StaffHomeScreen } from '../screens/staff/StaffHomeScreen';
import { NewOrderEntryScreen } from '../screens/staff/NewOrderEntryScreen';
import { OrderStatusScreen } from '../screens/shared/OrderStatusScreen';
import { SettingsScreen } from '../screens/shared/SettingsScreen';

export type StaffStackParamList = {
  StaffHome: undefined;
  NewOrderEntry: undefined;
  OrderStatus: { orderId: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<StaffStackParamList>();

export const StaffStack: React.FC = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="StaffHome" component={StaffHomeScreen} />
    <Stack.Screen name="NewOrderEntry" component={NewOrderEntryScreen} />
    <Stack.Screen name="OrderStatus" component={OrderStatusScreen} />
    <Stack.Screen name="Settings" component={SettingsScreen} />
  </Stack.Navigator>
);
