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
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Brand hero */}
      <LinearGradient
        colors={colors.gradients.heroSoft}
        start={{ x: 0, y: 0 }}
        end={{ x: 1.1, y: 1 }}
        style={styles.hero}
        pointerEvents="none"
      >
        <View style={[styles.orb, { top: -70, right: -50, width: 220, height: 220 }]} />
        <View style={[styles.orb, { bottom: 30, left: -60, width: 170, height: 170, opacity: 0.5 }]} />
        <View style={[styles.orbAccent, { top: 60, right: 40, width: 90, height: 90 }]} />
      </LinearGradient>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FadeSlideIn distance={16}>
            <View style={styles.brandRow}>
              <View style={styles.logoChip}>
                <Image source={require('../../../assets/logo.jpg')} style={styles.logoImg} resizeMode="cover" />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.base }}>
                <Text style={styles.brandName}>Same Day Solution</Text>
                <Text style={styles.tagline}>Aapke Har Transaction Ka Saathi</Text>
              </View>
            </View>
          </FadeSlideIn>

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

          <FadeSlideIn delay={240}>
            <View style={styles.trustRow}>
              {([
                ['flash-outline', 'Instant'],
                ['lock-closed-outline', 'Secure'],
                ['headset-outline', 'Support'],
              ] as const).map(([icon, label]) => (
                <View key={label} style={styles.trustItem}>
                  <View style={styles.trustIcon}>
                    <Ionicons name={icon} size={16} color={colors.primary[600]} />
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

const HERO_HEIGHT = 340;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  hero: {
    position: 'absolute', top: 0, left: 0, right: 0, height: HERO_HEIGHT,
    borderBottomLeftRadius: 34, borderBottomRightRadius: 34, overflow: 'hidden',
  },
  orb: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.10)' },
  orbAccent: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(251,146,60,0.28)' },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing['2xl'] },

  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xl, marginTop: spacing.md },
  logoChip: {
    width: 64, height: 64, borderRadius: 18, overflow: 'hidden',
    backgroundColor: colors.white, ...shadow.base,
  },
  logoImg: { width: '116%', height: '116%', alignSelf: 'center' },
  brandName: { ...typography.h1, color: colors.white },
  tagline: { ...typography.caption, color: 'rgba(255,255,255,0.85)', fontStyle: 'italic', marginTop: 2 },

  card: {
    backgroundColor: colors.surface, borderRadius: radius['2xl'], padding: spacing.xl,
    marginTop: spacing.lg, ...shadow.lg, shadowColor: '#0F172A', shadowOpacity: 0.12,
  },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  fields: { marginTop: spacing.lg },
  cta: { marginTop: spacing.sm, ...shadow.lg, shadowColor: colors.primary[600] },

  secureRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: spacing.base,
  },
  secureText: { ...typography.caption, color: colors.textSecondary },

  trustRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, marginTop: spacing.xl },
  trustItem: { alignItems: 'center', gap: 6 },
  trustIcon: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary[50],
    alignItems: 'center', justifyContent: 'center',
  },
  trustLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '600' },
  footer: {
    ...typography.small, color: colors.textMuted, textAlign: 'center',
    marginTop: spacing.lg, lineHeight: 16,
  },
});
