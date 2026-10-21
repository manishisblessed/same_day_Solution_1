import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
  TouchableOpacity, Alert, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Button, Input, FadeSlideIn } from '@/components';
import { useAuth } from '@/contexts/AuthContext';

export const LoginScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { signIn, signingIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing details', 'Enter your email and password.');
      return;
    }
    try {
      await signIn(email, password);
    } catch (e: any) {
      Alert.alert('Sign in failed', e?.message || 'Please check your credentials.');
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Full-screen gradient — no more blank section at bottom */}
      <LinearGradient
        colors={colors.gradients.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Subtle decorative orbs */}
      <View style={[styles.orb, { top: -80, right: -60, width: 240, height: 240 }]} />
      <View style={[styles.orb, { bottom: -80, left: -60, width: 220, height: 220, opacity: 0.4 }]} />
      <View style={[styles.orbAccent, { top: 80, right: 30, width: 80, height: 80 }]} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo + Brand */}
          <FadeSlideIn distance={16}>
            <View style={styles.brand}>
              <View style={styles.logoChip}>
                <Image source={require('../../../assets/logo.jpg')} style={styles.logoImg} resizeMode="cover" />
              </View>
              <Text style={styles.brandName}>Same Day Solution</Text>
              <Text style={styles.tagline}>Aapke Har Transaction Ka Saathi</Text>
            </View>
          </FadeSlideIn>

          {/* Login card */}
          <FadeSlideIn delay={120}>
            <View style={styles.card}>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Sign in to your account</Text>

              <View style={styles.fields}>
                <Input
                  label="Email"
                  icon="mail-outline"
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Input
                  label="Password"
                  icon="lock-closed-outline"
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  rightElement={
                    <TouchableOpacity onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
                      <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  }
                />
              </View>

              <Button
                title="Sign In"
                size="lg"
                fullWidth
                loading={signingIn}
                onPress={onSubmit}
                style={styles.cta}
              />

              <View style={styles.secureRow}>
                <Ionicons name="shield-checkmark" size={14} color={colors.primary[600]} />
                <Text style={styles.secureText}>Bank-grade encrypted connection</Text>
              </View>
            </View>
          </FadeSlideIn>

          {/* Trust badges */}
          <FadeSlideIn delay={240}>
            <View style={styles.trustRow}>
              {([
                ['flash-outline', 'Instant'],
                ['lock-closed-outline', 'Secure'],
                ['headset-outline', 'Support'],
              ] as const).map(([icon, label]) => (
                <View key={label} style={styles.trustItem}>
                  <View style={styles.trustIcon}>
                    <Ionicons name={icon} size={16} color={colors.white} />
                  </View>
                  <Text style={styles.trustLabel}>{label}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.footer}>
              Signing in here will end any active session on other devices.
            </Text>
          </FadeSlideIn>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  orb: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  orbAccent: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(251,146,60,0.22)' },

  scroll: { paddingHorizontal: spacing.xl, flexGrow: 1 },

  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logoChip: {
    width: 80, height: 80, borderRadius: 22, overflow: 'hidden',
    backgroundColor: colors.white, ...shadow.lg, marginBottom: spacing.md,
  },
  logoImg: { width: '110%', height: '110%', alignSelf: 'center' },
  brandName: { ...typography.h1, color: colors.white, textAlign: 'center' },
  tagline: { ...typography.caption, color: 'rgba(255,255,255,0.80)', fontStyle: 'italic', marginTop: 4, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface, borderRadius: radius['2xl'], padding: spacing.xl,
    ...shadow.lg, shadowColor: '#000', shadowOpacity: 0.18,
  },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  fields: { marginTop: spacing.sm },
  cta: { marginTop: spacing.sm },

  secureRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: spacing.base,
  },
  secureText: { ...typography.caption, color: colors.textSecondary },

  trustRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing['2xl'], marginTop: spacing.xl },
  trustItem: { alignItems: 'center', gap: 8 },
  trustIcon: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  trustLabel: { ...typography.small, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  footer: {
    ...typography.small, color: 'rgba(255,255,255,0.60)', textAlign: 'center',
    marginTop: spacing.lg, lineHeight: 18,
  },
});
