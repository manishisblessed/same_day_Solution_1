import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Button } from '@/components';
import { UpdateInfo } from '@/lib/updates';

export const UpdateRequiredScreen: React.FC<{ info: UpdateInfo }> = ({ info }) => (
  <View style={StyleSheet.absoluteFill}>
    <StatusBar style="light" />
    <LinearGradient colors={colors.gradients.primaryDeep} style={styles.fill}>
      <View style={styles.logo}>
        <Ionicons name="rocket" size={36} color={colors.primary[700]} />
      </View>
      <Text style={styles.title}>Update Required</Text>
      <Text style={styles.subtitle}>
        {info.message || 'A newer version of the app is available. Please update to continue.'}
      </Text>
      {info.storeUrl ? (
        <Button title="Update Now" icon="download" size="lg" onPress={() => Linking.openURL(info.storeUrl!)} style={{ marginTop: spacing.xl, minWidth: 220 }} />
      ) : null}
    </LinearGradient>
  </View>
);

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  logo: { width: 84, height: 84, borderRadius: 26, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadow.lg },
  title: { ...typography.h1, color: colors.white, marginTop: spacing.lg },
  subtitle: { ...typography.body, color: 'rgba(255,255,255,0.85)', marginTop: 8, textAlign: 'center', paddingHorizontal: spacing.lg },
});
