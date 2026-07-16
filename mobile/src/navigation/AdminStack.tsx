import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AdminTabs } from './AdminTabs';
import { OrderStatusScreen } from '../screens/shared/OrderStatusScreen';

export type AdminStackParamList = {
  AdminTabs: undefined;
  OrderStatus: { orderId: string };
};

const Stack = createNativeStackNavigator<AdminStackParamList>();

export const AdminStack: React.FC = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="AdminTabs" component={AdminTabs} />
    <Stack.Screen name="OrderStatus" component={OrderStatusScreen} />
  </Stack.Navigator>
);
