import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppStackParamList } from './types';
import { TabNavigator } from './TabNavigator';
import { BbpsScreen } from '@/screens/services/BbpsScreen';
import { Pay2NewScreen } from '@/screens/services/Pay2NewScreen';
import { CreditCard2Screen } from '@/screens/services/CreditCard2Screen';
import { ApiPaymentScreen } from '@/screens/services/ApiPaymentScreen';
import { PayoutScreen } from '@/screens/services/PayoutScreen';
import { Settlement2Screen } from '@/screens/services/Settlement2Screen';
import { AepsScreen } from '@/screens/services/AepsScreen';
import { PosMachinesScreen } from '@/screens/services/PosMachinesScreen';
import { SubscriptionsScreen } from '@/screens/services/SubscriptionsScreen';
import { MdrSchemesScreen } from '@/screens/services/MdrSchemesScreen';
import { LedgerScreen } from '@/screens/LedgerScreen';
import { PushPullScreen } from '@/screens/PushPullScreen';
import { TransactionsListScreen } from '@/screens/TransactionsListScreen';
import { TpinScreen } from '@/screens/TpinScreen';

const Stack = createNativeStackNavigator<AppStackParamList>();

export const AppNavigator: React.FC = () => (
  <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
    <Stack.Screen name="Tabs" component={TabNavigator} />
    <Stack.Screen name="Bbps" component={BbpsScreen} />
    <Stack.Screen name="Pay2New" component={Pay2NewScreen} />
    <Stack.Screen name="CreditCard2" component={CreditCard2Screen} />
    <Stack.Screen name="ApiPayment" component={ApiPaymentScreen} />
    <Stack.Screen name="Payout" component={PayoutScreen} />
    <Stack.Screen name="Settlement2" component={Settlement2Screen} />
    <Stack.Screen name="Aeps" component={AepsScreen} />
    <Stack.Screen name="PosMachines" component={PosMachinesScreen} />
    <Stack.Screen name="Subscriptions" component={SubscriptionsScreen} />
    <Stack.Screen name="MdrSchemes" component={MdrSchemesScreen} />
    <Stack.Screen name="Ledger" component={LedgerScreen} />
    <Stack.Screen name="PushPull" component={PushPullScreen} />
    <Stack.Screen name="TransactionsList" component={TransactionsListScreen} />
    <Stack.Screen name="Tpin" component={TpinScreen} />
  </Stack.Navigator>
);
