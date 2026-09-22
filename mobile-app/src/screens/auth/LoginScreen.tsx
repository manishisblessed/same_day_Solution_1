import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
  TouchableOpacity, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Button, Input } from '@/components';
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
      <LinearGradient
        colors={colors.gradients.logo}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.top, { paddingTop: insets.top + 48 }]}
      >
        <View style={styles.logo}>
          <Ionicons name="storefront" size={32} color={colors.primary[600]} />
        </View>
        <Text style={styles.brand}>Sameday</Text>
        <Text style={styles.tagline}>Retailer App</Text>
      </LinearGradient>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.formWrap}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Text style={[typography.h2, { color: colors.textPrimary }]}>Welcome back</Text>
            <Text style={[typography.body, { color: colors.textSecondary, marginBottom: spacing.lg }]}>
              Sign in to your retailer account
            </Text>

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

            <Button title="Sign In" size="lg" fullWidth loading={signingIn} onPress={onSubmit} style={{ marginTop: spacing.sm }} />

            <Text style={styles.footer}>
              Signing in here will end any active session on other devices.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  top: { paddingBottom: 56, alignItems: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  logo: {
    width: 72, height: 72, borderRadius: 22, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.base, ...shadow.lg,
  },
  brand: { ...typography.display, color: colors.white },
  tagline: { ...typography.bodyMedium, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  formWrap: { flex: 1, marginTop: -32 },
  scroll: { paddingHorizontal: spacing.base, paddingBottom: spacing['2xl'] },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, ...shadow.lg },
  footer: { ...typography.small, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg, lineHeight: 16 },
});
