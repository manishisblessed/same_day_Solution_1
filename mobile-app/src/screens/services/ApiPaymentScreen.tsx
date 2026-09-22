import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { Screen, Card, Input, Button, Pill, Badge, statusTone } from '@/components';
import { apiPaymentSale, apiPaymentStatus, apiPaymentAbort } from '@/api/apiPayment';
import { ApiError } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

type Phase = 'idle' | 'starting' | 'waiting' | 'done';

export const ApiPaymentScreen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [payMode, setPayMode] = useState<'Card' | 'QR' | 'All'>('All');
  const [phase, setPhase] = useState<Phase>('idle');
  const [txnId, setTxnId] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const amt = parseFloat(amount) || 0;

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startSale = async () => {
    if (amt < 1) return Alert.alert('Invalid amount', 'Enter a valid amount.');
    setPhase('starting');
    setResult(null);
    try {
      const res = await apiPaymentSale({ amount: amt, paymentMode: payMode });
      setTxnId(res.merchantTransactionId);
      setPhase('waiting');
      poll(res.merchantTransactionId);
    } catch (e) {
      setPhase('idle');
      Alert.alert('Could not start', e instanceof ApiError ? e.message : 'Please try again.');
    }
  };

  const poll = (id: string) => {
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries++;
      try {
        const s = await apiPaymentStatus(id);
        if (s.isFinal || tries > 40) {
          if (pollRef.current) clearInterval(pollRef.current);
          setResult(s);
          setPhase('done');
          qc.invalidateQueries({ queryKey: ['wallet'] });
        }
      } catch {
        // keep polling
      }
    }, 5000);
  };

  const cancel = async () => {
    if (txnId) await apiPaymentAbort(txnId).catch(() => {});
    if (pollRef.current) clearInterval(pollRef.current);
    setPhase('idle');
    setTxnId(null);
  };

  const reset = () => { setPhase('idle'); setTxnId(null); setResult(null); setAmount(''); };

  return (
    <Screen title="API Payment" subtitle="Card / QR sale on POS" onBack={() => nav.goBack()}>
      {phase === 'idle' || phase === 'starting' ? (
        <>
          <Card style={{ marginTop: spacing.sm }}>
            <Input label="Amount (₹)" icon="cash-outline" value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" />
            <Text style={[typography.captionMedium, { color: colors.textPrimary, marginBottom: 8 }]}>Payment Mode</Text>
            <View style={{ flexDirection: 'row' }}>
              <Pill label="All" active={payMode === 'All'} onPress={() => setPayMode('All')} />
              <Pill label="Card" active={payMode === 'Card'} onPress={() => setPayMode('Card')} />
              <Pill label="QR" active={payMode === 'QR'} onPress={() => setPayMode('QR')} />
            </View>
          </Card>
          <Button title={`Charge ${amt ? formatCurrency(amt) : ''}`} size="lg" fullWidth loading={phase === 'starting'} disabled={amt < 1} style={{ marginTop: spacing.lg }} onPress={startSale} />
        </>
      ) : phase === 'waiting' ? (
        <Card style={{ marginTop: spacing.lg, alignItems: 'center', paddingVertical: spacing['2xl'] }}>
          <ActivityIndicator size="large" color={colors.primary[600]} />
          <Text style={[typography.h3, { color: colors.textPrimary, marginTop: spacing.base }]}>Waiting for payment…</Text>
          <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center', marginTop: 4 }]}>Complete the {formatCurrency(amt)} payment on the POS terminal.</Text>
          <Button title="Cancel" variant="ghost" style={{ marginTop: spacing.lg }} onPress={cancel} />
        </Card>
      ) : (
        <Card style={{ marginTop: spacing.lg, alignItems: 'center', paddingVertical: spacing.xl }}>
          <Ionicons
            name={result?.resultStatus?.toUpperCase?.() === 'SUCCESS' ? 'checkmark-circle' : 'close-circle'}
            size={64}
            color={result?.resultStatus?.toUpperCase?.() === 'SUCCESS' ? colors.success[500] : colors.danger[500]}
          />
          <Text style={[typography.h2, { color: colors.textPrimary, marginTop: spacing.md }]}>{formatCurrency(result?.amount ?? amt)}</Text>
          <View style={{ marginTop: 6 }}><Badge label={result?.resultStatus || 'Unknown'} tone={statusTone(result?.resultStatus)} /></View>
          <View style={styles.details}>
            {result?.rrn ? <Detail label="RRN" value={result.rrn} /> : null}
            {result?.cardScheme ? <Detail label="Card" value={`${result.cardScheme} ${result.cardNumber || ''}`} /> : null}
            {result?.authCode ? <Detail label="Auth Code" value={result.authCode} /> : null}
            {result?.transactionId ? <Detail label="Txn ID" value={result.transactionId} /> : null}
          </View>
          <Button title="New Payment" fullWidth style={{ marginTop: spacing.lg }} onPress={reset} />
        </Card>
      )}
    </Screen>
  );
};

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.detailRow}>
    <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
    <Text style={[typography.captionMedium, { color: colors.textPrimary }]} numberOfLines={1}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  details: { alignSelf: 'stretch', marginTop: spacing.lg, gap: 8 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
