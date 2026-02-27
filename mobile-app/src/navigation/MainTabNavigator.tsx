import React from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { DashboardScreen } from '../screens/DashboardScreen';
import { TransactionsScreen } from '../screens/TransactionsScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { SettlementScreen } from '../screens/SettlementScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { colors, typography } from '../theme';

const Tab = createBottomTabNavigator();

function getTabIcon(routeName: string, focused: boolean) {
  let iconName: keyof typeof Ionicons.glyphMap;

  switch (routeName) {
    case 'Dashboard':
      iconName = focused ? 'grid' : 'grid-outline';
      break;
    case 'Transactions':
      iconName = focused ? 'swap-horizontal' : 'swap-horizontal-outline';
      break;
    case 'Wallet':
      iconName = focused ? 'wallet' : 'wallet-outline';
      break;
    case 'Settlement':
      iconName = focused ? 'arrow-up-circle' : 'arrow-up-circle-outline';
      break;
    case 'Profile':
      iconName = focused ? 'person' : 'person-outline';
      break;
    default:
      iconName = 'ellipse-outline';
  }

  return (
    <View style={focused ? styles.activeIconWrapper : undefined}>
      <Ionicons
        name={iconName}
        size={22}
        color={focused ? colors.primary[600] : colors.gray[400]}
      />
    </View>
  );
}

function getTabLabel(routeName: string) {
  switch (routeName) {
    case 'Dashboard': return 'Home';
    case 'Transactions': return 'Transactions';
    case 'Wallet': return 'Wallet';
    case 'Settlement': return 'Settlement';
    case 'Profile': return 'Profile';
    default: return routeName;
  }
}

export function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => getTabIcon(route.name, focused),
        tabBarLabel: getTabLabel(route.name),
        tabBarActiveTintColor: colors.primary[600],
        tabBarInactiveTintColor: colors.gray[400],
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: styles.tabBar,
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Transactions" component={TransactionsScreen} />
      <Tab.Screen name="Wallet" component={WalletScreen} />
      <Tab.Screen name="Settlement" component={SettlementScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.white,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: Platform.OS === 'ios' ? 88 : 64,
    paddingTop: 6,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    marginBottom: Platform.OS === 'ios' ? 0 : 8,
  },
  activeIconWrapper: {
    backgroundColor: colors.primary[50],
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
});
