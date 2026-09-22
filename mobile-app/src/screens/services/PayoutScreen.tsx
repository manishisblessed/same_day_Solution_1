import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { Screen, Card, Input, Button, Badge, Pill, TpinSheet } from '@/components';
import { verifyAccount, payoutTransfer } from '@/api/payout';
import { ApiError } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

export const PayoutScreen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const [account, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'IMPS' | 'NEFT'>('IMPS');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<{ name: string; bank: string } | null>(null);
  const [tpinOpen, setTpinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const amt = parseFloat(amount) || 0;

  const verify = async () => {
    if (account.length < 6 || ifsc.length < 6) return Alert.alert('Invalid', 'Enter a valid account number and IFSC.');
    setVerifying(true);
    setVerified(null);
    try {
      const res = await verifyAccount({ accountNumber: account.trim(), ifscCode: ifsc.trim().toUpperCase() });
      if (res.is_valid) {
        setVerified({ name: res.account_holder_name, bank: res.bank_name });
      } else {
        Alert.alert('Verification failed', res.message || 'Account could not be verified.');
      }
    } catch (e) {
      Alert.alert('Error', e instanceof ApiError ? e.message : 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const startTransfer = () => {
    if (!verified) return Alert.alert('Verify first', 'Please verify the account before transferring.');
    if (amt < 1) return Alert.alert('Invalid amount', 'Enter a valid amount.');
    setTpinOpen(true);
  };

  const doTransfer = async (tpin: string) => {
    setSubmitting(true);
    try {
      const res = await payoutTransfer({
        accountNumber: account.trim(),
        ifscCode: ifsc.trim().toUpperCase(),
        accountHolderName: verified!.name,
        amount: amt,
        transferMode: mode,
        bankName: verified!.bank,
        tpin,
      });
      setTpinOpen(false);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      Alert.alert(
        res.success ? 'Transfer submitted' : 'Transfer status',
        `${res.status?.toUpperCase()} · ${formatCurrency(res.amount)}\nCharges: ${formatCurrency(res.charges)}\nTxn: ${res.transaction_id || res.provider_txn_id || '—'}`,
        [{ text: 'Done', onPress: () => nav.goBack() }]
      );
    } catch (e) {
      setTpinOpen(false);
      Alert.alert('Transfer failed', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen title="Settlement-1" subtitle="Bank transfer (Payout)" onBack={() => nav.goBack()}>
      <Card style={{ marginTop: spacing.sm }}>
        <Input label="Account Number" icon="card-outline" value={account} onChangeText={(t) => { setAccount(t.replace(/\D/g, '')); setVerified(null); }} keyboardType="number-pad" placeholder="Beneficiary account number" />
        <Input label="IFSC Code" icon="business-outline" value={ifsc} onChangeText={(t) => { setIfsc(t.toUpperCase()); setVerified(null); }} autoCapitalize="characters" placeholder="e.g. HDFC0001234" />
        <Button title={verified ? 'Re-verify' : 'Verify Account'} variant="outline" icon="shield-checkmark-outline" loading={verifying} onPress={verify} />
        {verified && (
          <View style={styles.verified}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success[600]} />
            <View style={{ marginLeft: 8, flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{verified.name}</Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>{verified.bank}</Text>
            </View>
            <Badge label="Verified" tone="success" />
          </View>
        )}
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <Input label="Amount (₹)" icon="cash-outline" value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" />
        <Text style={[typography.captionMedium, { color: colors.textPrimary, marginBottom: 8 }]}>Transfer Mode</Text>
        <View style={{ flexDirection: 'row' }}>
          <Pill label="IMPS (instant)" active={mode === 'IMPS'} onPress={() => setMode('IMPS')} />
          <Pill label="NEFT" active={mode === 'NEFT'} onPress={() => setMode('NEFT')} />
        </View>
      </Card>

      <Button title={`Transfer ${amt ? formatCurrency(amt) : ''}`} size="lg" fullWidth style={{ marginTop: spacing.lg }} disabled={!verified || amt < 1} onPress={startTransfer} />

      <TpinSheet visible={tpinOpen} amount={amt} submitting={submitting} onCancel={() => setTpinOpen(false)} onConfirm={doTransfer} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  verified: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.success[50], borderRadius: radius.base, padding: spacing.md, marginTop: spacing.sm },
});
