import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AdminDashboardScreen } from '../screens/admin/AdminDashboardScreen';
import { GarmentCatalogueScreen } from '../screens/admin/GarmentCatalogueScreen';
import { LedgerAgingScreen } from '../screens/admin/LedgerAgingScreen';
import { BranchesScreen } from '../screens/admin/BranchesScreen';
import { colors } from '../theme/theme';

export type AdminTabParamList = {
  Orders: undefined;
  Catalogue: undefined;
  Ledger: undefined;
  Branches: undefined;
};

const Tab = createBottomTabNavigator<AdminTabParamList>();

// Matches the mockup's bottom .tab-bar (Orders / Catalogue / Ledger / Branches).
export const AdminTabs: React.FC = () => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.white,
      tabBarInactiveTintColor: '#8FA0BE',
      tabBarActiveBackgroundColor: colors.peachPrimary,
      tabBarStyle: { backgroundColor: colors.navyDeep, borderTopWidth: 0 },
      tabBarLabelStyle: { fontSize: 9, fontWeight: '700' },
    }}
  >
    <Tab.Screen name="Orders" component={AdminDashboardScreen} />
    <Tab.Screen name="Catalogue" component={GarmentCatalogueScreen} />
    <Tab.Screen name="Ledger" component={LedgerAgingScreen} />
    <Tab.Screen name="Branches" component={BranchesScreen} />
  </Tab.Navigator>
);
