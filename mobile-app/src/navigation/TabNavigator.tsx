import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { colors } from '@/theme';
import { TabParamList } from './types';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { WalletScreen } from '@/screens/WalletScreen';
import { ServicesHubScreen } from '@/screens/ServicesHubScreen';
import { ReportsScreen } from '@/screens/ReportsScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';

const Tab = createBottomTabNavigator<TabParamList>();

const ICONS: Record<keyof TabParamList, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Home: ['home', 'home-outline'],
  Wallet: ['wallet', 'wallet-outline'],
  Services: ['grid', 'grid-outline'],
  Reports: ['bar-chart', 'bar-chart-outline'],
  Profile: ['person', 'person-outline'],
};

export const TabNavigator: React.FC = () => (
  <Tab.Navigator
    screenOptions={({ route }) => ({
      headerShown: false,
      tabBarActiveTintColor: colors.primary[600],
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: {
        height: Platform.OS === 'ios' ? 84 : 64,
        paddingBottom: Platform.OS === 'ios' ? 26 : 10,
        paddingTop: 8,
        borderTopColor: colors.border,
        backgroundColor: colors.surface,
      },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      tabBarIcon: ({ focused, color, size }) => {
        const [active, inactive] = ICONS[route.name];
        return <Ionicons name={focused ? active : inactive} size={size - 2} color={color} />;
      },
    })}
  >
    <Tab.Screen name="Home" component={DashboardScreen} />
    <Tab.Screen name="Wallet" component={WalletScreen} />
    <Tab.Screen name="Services" component={ServicesHubScreen} />
    <Tab.Screen name="Reports" component={ReportsScreen} />
    <Tab.Screen name="Profile" component={ProfileScreen} />
  </Tab.Navigator>
);
