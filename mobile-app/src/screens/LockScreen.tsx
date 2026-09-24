import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Button } from '@/components';
import { useAppLock } from '@/contexts/AppLockContext';

export const LockScreen: React.FC = () => {
  const { unlock } = useAppLock();
  const [tried, setTried] = useState(false);

  const run = async () => {
    const ok = await unlock();
    setTried(!ok);
  };

  useEffect(() => { run(); }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <StatusBar style="light" />
      <LinearGradient colors={colors.gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
        <View style={styles.logo}>
          <Ionicons name="lock-closed" size={36} color={colors.primary[700]} />
        </View>
        <Text style={styles.title}>App Locked</Text>
        <Text style={styles.subtitle}>Verify your identity to continue</Text>
        <Button
          title={tried ? 'Try Again' : 'Unlock'}
          icon="finger-print"
          size="lg"
          onPress={run}
          style={{ marginTop: spacing.xl, minWidth: 200 }}
        />
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  logo: { width: 84, height: 84, borderRadius: 26, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadow.lg },
  title: { ...typography.h1, color: colors.white, marginTop: spacing.lg },
  subtitle: { ...typography.body, color: 'rgba(255,255,255,0.8)', marginTop: 6 },
});
