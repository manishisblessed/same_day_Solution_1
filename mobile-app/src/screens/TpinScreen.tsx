import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { Screen, Input, Button, Card } from '@/components';
import { setTpin } from '@/api/auth';
import { ApiError } from '@/lib/api';

export const TpinScreen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) return Alert.alert('Invalid TPIN', 'TPIN must be 4 digits.');
    if (pin !== confirm) return Alert.alert('Mismatch', 'The TPINs do not match.');
    setBusy(true);
    try {
      await setTpin(pin);
      qc.invalidateQueries({ queryKey: ['tpin-status'] });
      Alert.alert('Success', 'Your TPIN has been saved.', [{ text: 'OK', onPress: () => nav.goBack() }]);
    } catch (e) {
      Alert.alert('Failed', e instanceof ApiError ? e.message : 'Could not save TPIN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="TPIN" subtitle="4-digit transaction PIN" onBack={() => nav.goBack()}>
      <Card style={{ marginTop: spacing.base, marginBottom: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Ionicons name="shield-checkmark" size={22} color={colors.primary[600]} />
        <Text style={[typography.caption, { color: colors.textSecondary, flex: 1 }]}>
          Your TPIN authorizes every money transfer (payout, bills, settlements). Keep it secret.
        </Text>
      </Card>

      <Input
        label="New TPIN"
        icon="keypad-outline"
        placeholder="••••"
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
      />
      <Input
        label="Confirm TPIN"
        icon="keypad-outline"
        placeholder="••••"
        value={confirm}
        onChangeText={(t) => setConfirm(t.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
      />
      <Button title="Save TPIN" size="lg" fullWidth loading={busy} onPress={submit} style={{ marginTop: spacing.sm }} />
    </Screen>
  );
};

const styles = StyleSheet.create({});
