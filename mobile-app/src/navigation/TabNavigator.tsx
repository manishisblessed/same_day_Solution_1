import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

export const TabNavigator: React.FC = () => {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary[600],
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          height: 60 + Math.max(insets.bottom, 8),
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
          borderTopWidth: 0,
          backgroundColor: colors.surface,
          elevation: 16,
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.06,
          shadowRadius: 12,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ focused, color, size }) => {
          const [active, inactive] = ICONS[route.name];
          return (
            <View style={styles.iconWrap}>
              {focused ? <View style={styles.activeDot} /> : null}
              <Ionicons name={focused ? active : inactive} size={size - 2} color={color} />
            </View>
          );
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
};

const styles = StyleSheet.create({
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  activeDot: {
    position: 'absolute',
    top: -8,
    width: 16,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary[600],
  },
});
