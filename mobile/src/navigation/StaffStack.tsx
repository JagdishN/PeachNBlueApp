import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StaffHomeScreen } from '../screens/staff/StaffHomeScreen';
import { NewOrderEntryScreen } from '../screens/staff/NewOrderEntryScreen';
import { OrderStatusScreen } from '../screens/shared/OrderStatusScreen';

export type StaffStackParamList = {
  StaffHome: undefined;
  NewOrderEntry: undefined;
  OrderStatus: { orderId: string };
};

const Stack = createNativeStackNavigator<StaffStackParamList>();

export const StaffStack: React.FC = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="StaffHome" component={StaffHomeScreen} />
    <Stack.Screen name="NewOrderEntry" component={NewOrderEntryScreen} />
    <Stack.Screen name="OrderStatus" component={OrderStatusScreen} />
  </Stack.Navigator>
);
