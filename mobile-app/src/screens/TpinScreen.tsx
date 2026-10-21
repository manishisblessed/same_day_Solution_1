import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Screen, Input, Button, Card } from '@/components';
import { setTpin, fetchTpinStatus } from '@/api/auth';
import { ApiError } from '@/lib/api';

export const TpinScreen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: ['tpin-status'], queryFn: fetchTpinStatus });
  const isChange = statusQ.data?.tpin_enabled === true;

  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (isChange && (current.length !== 4 || !/^\d{4}$/.test(current))) {
      return Alert.alert('Invalid', 'Enter your current 4-digit TPIN.');
    }
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return Alert.alert('Invalid TPIN', 'New TPIN must be exactly 4 digits.');
    }
    if (pin !== confirm) return Alert.alert('Mismatch', 'The new TPINs do not match.');
    setBusy(true);
    try {
      await setTpin(pin, isChange ? current : undefined);
      qc.invalidateQueries({ queryKey: ['tpin-status'] });
      Alert.alert('Success', isChange ? 'TPIN changed successfully.' : 'TPIN set successfully.', [
        { text: 'OK', onPress: () => nav.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Failed', e instanceof ApiError ? e.message : 'Could not save TPIN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={isChange ? 'Change TPIN' : 'Set TPIN'} subtitle="4-digit transaction PIN" onBack={() => nav.goBack()}>
      <Card style={{ marginTop: spacing.base, marginBottom: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Ionicons name="shield-checkmark" size={22} color={colors.primary[600]} />
        <Text style={[typography.caption, { color: colors.textSecondary, flex: 1 }]}>
          Your TPIN authorizes every money transfer (payout, bills, settlements). Keep it secret.
        </Text>
      </Card>

      {isChange && (
        <Input
          label="Current TPIN"
          icon="lock-closed-outline"
          placeholder="••••"
          value={current}
          onChangeText={(t) => setCurrent(t.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
        />
      )}
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
        label="Confirm New TPIN"
        icon="keypad-outline"
        placeholder="••••"
        value={confirm}
        onChangeText={(t) => setConfirm(t.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
      />
      <Button
        title={isChange ? 'Change TPIN' : 'Set TPIN'}
        size="lg"
        fullWidth
        loading={busy || statusQ.isLoading}
        onPress={submit}
        style={{ marginTop: spacing.sm }}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({});
