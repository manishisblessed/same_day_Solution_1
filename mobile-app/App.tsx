import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { View, Text, StyleSheet } from 'react-native';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider } from '@/contexts/AuthContext';
import { AppLockProvider } from '@/contexts/AppLockContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RootNavigator } from '@/navigation/RootNavigator';
import { assertEnv } from '@/config/env';
import { colors, spacing, typography } from '@/theme';

function MissingEnv({ missing }: { missing: string[] }) {
  return (
    <View style={styles.envError}>
      <Text style={[typography.h2, { color: colors.danger[600], marginBottom: 12 }]}>Configuration required</Text>
      <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
        Missing env values:{'\n'}
        {missing.join('\n')}
        {'\n\n'}Copy .env.example → .env, fill in your Supabase URL + anon key, then restart.
      </Text>
    </View>
  );
}

export default function App() {
  const missing = assertEnv();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            {missing.length > 0 ? (
              <MissingEnv missing={missing} />
            ) : (
              <AuthProvider>
                <AppLockProvider>
                  <RootNavigator />
                </AppLockProvider>
              </AuthProvider>
            )}
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  envError: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background },
});
