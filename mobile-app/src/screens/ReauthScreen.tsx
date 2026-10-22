import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Button, TpinSheet } from '@/components';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Shown as an overlay when the current session was superseded by a login on
 * another device (single-session "replaced"). Lets the user resume with
 * biometric or TPIN — no password — or fall back to a full sign-in.
 */
export const ReauthScreen: React.FC = () => {
  const { user, hasTpin, resumeWithBiometric, resumeWithTpin, cancelReauth } = useAuth();
  const [bioAvailable, setBioAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tpinOpen, setTpinOpen] = useState(false);
  const [tpinSubmitting, setTpinSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const name = user?.name || user?.email || 'your account';

  const runBiometric = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const res = await resumeWithBiometric();
    setBusy(false);
    if (!res.ok && res.error && res.error !== 'biometric_failed') {
      setMessage(res.error);
    }
  }, [resumeWithBiometric]);

  // Detect biometric support, and auto-prompt once if available.
  useEffect(() => {
    (async () => {
      let ok = false;
      try {
        const [hw, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        ok = hw && enrolled;
      } catch {}
      setBioAvailable(ok);
      setChecked(true);
      if (ok) runBiometric();
    })();
  }, [runBiometric]);

  const onTpinConfirm = useCallback(async (tpin: string) => {
    setTpinSubmitting(true);
    setMessage(null);
    const res = await resumeWithTpin(tpin);
    setTpinSubmitting(false);
    if (res.ok) {
      setTpinOpen(false);
    } else {
      setMessage(res.error || 'Could not verify TPIN');
    }
  }, [resumeWithTpin]);

  const noFactors = checked && !bioAvailable && !hasTpin;

  return (
    <View style={StyleSheet.absoluteFill}>
      <StatusBar style="light" />
      <LinearGradient colors={colors.gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
        <View style={styles.logo}>
          <Ionicons name="shield-checkmark" size={36} color={colors.primary[700]} />
        </View>

        <Text style={styles.title}>Session Paused</Text>
        <Text style={styles.subtitle}>
          {noFactors
            ? 'Your account was opened on another device. Please sign in again to continue.'
            : `You were signed in on another device. Verify to resume ${name}.`}
        </Text>

        {message ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.white} />
            <Text style={styles.errorText}>{message}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {bioAvailable && (
            <Button
              title={busy ? 'Verifying…' : 'Unlock with Biometric'}
              icon="finger-print"
              size="lg"
              loading={busy}
              onPress={runBiometric}
              style={{ minWidth: 240 }}
            />
          )}

          {hasTpin && (
            <Button
              title="Use TPIN instead"
              icon="keypad"
              size="lg"
              variant={bioAvailable ? 'outline' : 'primary'}
              onPress={() => { setMessage(null); setTpinOpen(true); }}
              style={{ minWidth: 240, marginTop: spacing.md }}
            />
          )}

          <TouchableOpacity onPress={cancelReauth} style={styles.linkBtn} hitSlop={10}>
            <Text style={styles.linkText}>Sign in with password</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <TpinSheet
        visible={tpinOpen}
        title="Enter TPIN to resume"
        submitting={tpinSubmitting}
        onCancel={() => setTpinOpen(false)}
        onConfirm={onTpinConfirm}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  logo: { width: 84, height: 84, borderRadius: 26, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadow.lg },
  title: { ...typography.h1, color: colors.white, marginTop: spacing.lg },
  subtitle: { ...typography.body, color: 'rgba(255,255,255,0.85)', marginTop: 8, textAlign: 'center', paddingHorizontal: spacing.md },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(220,38,38,0.85)', borderRadius: radius.base,
    paddingHorizontal: spacing.md, paddingVertical: 8, marginTop: spacing.lg,
  },
  errorText: { ...typography.caption, color: colors.white, flexShrink: 1 },
  actions: { marginTop: spacing.xl, alignItems: 'center' },
  linkBtn: { marginTop: spacing.lg, paddingVertical: 8 },
  linkText: { ...typography.bodyMedium, color: colors.white, textDecorationLine: 'underline' },
});
