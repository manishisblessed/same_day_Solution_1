import { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Home: undefined;
  Wallet: undefined;
  Services: undefined;
  Reports: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  Bbps: undefined;
  Pay2New: { mode: 'bbps' | 'credit-card' | 'recharge' };
  CreditCard2: undefined;
  ApiPayment: undefined;
  Payout: undefined;
  Settlement2: undefined;
  Aeps: undefined;
  PosMachines: undefined;
  Subscriptions: undefined;
  MdrSchemes: undefined;
  Ledger: undefined;
  PushPull: undefined;
  TransactionsList: { service?: string } | undefined;
  Tpin: undefined;
};

export type RootParamList = {
  Auth: undefined;
  App: NavigatorScreenParams<AppStackParamList>;
};
