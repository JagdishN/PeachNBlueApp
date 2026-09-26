import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AdminDashboardScreen } from '../screens/admin/AdminDashboardScreen';
import { GarmentCatalogueScreen } from '../screens/admin/GarmentCatalogueScreen';
import { LedgerAgingScreen } from '../screens/admin/LedgerAgingScreen';
import { BranchesScreen } from '../screens/admin/BranchesScreen';
import { CustomerManagementScreen } from '../screens/admin/CustomerManagementScreen';
import { StaffManagementScreen } from '../screens/admin/StaffManagementScreen';
import { useTheme } from '../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';


export type AdminTabParamList = {
  Orders: undefined;
  Catalogue: undefined;
  Customers: undefined;
  Ledger: undefined;
  Branches: undefined;
  Staff: undefined;
};

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Orders: 'receipt-outline',
  Catalogue: 'shirt-outline',
  Customers: 'people-outline',
  Ledger: 'wallet-outline',
  Branches: 'business-outline',
  Staff: 'person-outline',
};

const Tab = createBottomTabNavigator<AdminTabParamList>();

// Matches the mockup's bottom .tab-bar (Orders / Catalogue / Ledger / Branches).
export const AdminTabs: React.FC = () => {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.white,
        tabBarInactiveTintColor: '#8FA0BE',
        tabBarActiveBackgroundColor: colors.peachPrimary,
        tabBarStyle: { backgroundColor: colors.chrome, borderTopWidth: 0 },
        tabBarLabelStyle: { fontSize: 9, fontWeight: '700' },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={ICONS[route.name]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Orders" component={AdminDashboardScreen} />
      <Tab.Screen name="Catalogue" component={GarmentCatalogueScreen} />
      <Tab.Screen name="Customers" component={CustomerManagementScreen} />
      <Tab.Screen name="Ledger" component={LedgerAgingScreen} />
      <Tab.Screen name="Branches" component={BranchesScreen} />
      <Tab.Screen name="Staff" component={StaffManagementScreen} />
    </Tab.Navigator>
  );
};
