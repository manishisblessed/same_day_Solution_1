import React, { useEffect, useRef, useState } from 'react';
import { View, Alert } from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '@/contexts/AuthContext';
import { useAppLock } from '@/contexts/AppLockContext';
import { ServicesProvider } from '@/contexts/ServicesContext';
import { Loading } from '@/components';
import { colors } from '@/theme';
import { RootParamList } from './types';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { AppNavigator } from './AppNavigator';
import { LockScreen } from '@/screens/LockScreen';
import { UpdateRequiredScreen } from '@/screens/UpdateRequiredScreen';
import { checkForUpdate, UpdateInfo } from '@/lib/updates';
import { registerForPush, addNotificationResponseListener } from '@/lib/notifications';

const Stack = createNativeStackNavigator<RootParamList>();

export const RootNavigator: React.FC = () => {
  const { user, initializing, kickedReason, clearKicked } = useAuth();
  const { enabled: lockEnabled, locked } = useAppLock();
  const [update, setUpdate] = useState<UpdateInfo>({ required: false, available: false });
  const navRef = useRef<NavigationContainerRef<RootParamList>>(null);

  // Force-update check on launch.
  useEffect(() => {
    checkForUpdate().then(setUpdate);
  }, []);

  // Register push + handle taps once the retailer is signed in.
  useEffect(() => {
    if (!user) return;
    registerForPush();
    const sub = addNotificationResponseListener((data) => {
      if (data?.screen && navRef.current) {
        try {
          (navRef.current as any).navigate('App', { screen: data.screen });
        } catch {}
      }
    });
    return () => sub.remove();
  }, [user]);

  useEffect(() => {
    if (kickedReason) {
      Alert.alert('Signed out', kickedReason, [{ text: 'OK', onPress: clearKicked }]);
    }
  }, [kickedReason, clearKicked]);

  if (update.required) return <UpdateRequiredScreen info={update} />;

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Loading label="Starting…" />
      </View>
    );
  }

  return (
    <>
      <NavigationContainer ref={navRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {user ? (
            <Stack.Screen name="App">
              {() => (
                <ServicesProvider>
                  <AppNavigator />
                </ServicesProvider>
              )}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="Auth" component={LoginScreen} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {lockEnabled && locked ? <LockScreen /> : null}
    </>
  );
};
