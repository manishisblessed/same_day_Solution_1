import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Screen, Card, Input, Button, Loading, EmptyState, TpinSheet } from '@/components';
import { fetchRkOperators, fetchRkCharges, rkPay, RkOperator } from '@/api/rechargekit';
import { ApiError } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

export const CreditCard2Screen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const [operator, setOperator] = useState<RkOperator | null>(null);
  const [card, setCard] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [amount, setAmount] = useState('');
  const [tpinOpen, setTpinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const amt = parseFloat(amount) || 0;
  const opQ = useQuery({ queryKey: ['rk-operators'], queryFn: fetchRkOperators });
  const chargesQ = useQuery({ queryKey: ['rk-charges', amt], queryFn: () => fetchRkCharges(amt), enabled: amt >= 1 });
  const operators = opQ.data?.operators ?? [];

  const valid = operator && card.length >= 6 && ifsc.length >= 6 && bankName && name && mobile.length === 10 && amt >= 1;

  const doPay = async (tpin: string) => {
    if (!operator) return;
    setSubmitting(true);
    try {
      const res = await rkPay({
        mobile_no: mobile.trim(),
        account_no: card.trim(),
        ifsc: ifsc.trim().toUpperCase(),
        bank_name: bankName.trim(),
        beneficiary_name: name.trim(),
        amount: amt,
        operator_code: operator.operator_code,
        operator_name: operator.operator_name,
        tpin,
      });
      setTpinOpen(false);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      Alert.alert(res.success ? 'Payment submitted' : 'Payment status', `${res.pending ? 'PROCESSING' : 'DONE'}\nOrder: ${res.order_id}\n${res.message || ''}`, [
        { text: 'Done', onPress: () => nav.goBack() },
      ]);
    } catch (e) {
      setTpinOpen(false);
      Alert.alert('Payment failed', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen title="Credit Card-2" subtitle="Pay credit card via bank transfer" onBack={() => nav.goBack()}>
      <Text style={styles.label}>Card Network / Operator</Text>
      {opQ.isLoading ? <Loading /> : operators.length === 0 ? (
        <Card><EmptyState title="No operators" /></Card>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
          {operators.map((o) => (
            <TouchableOpacity key={o.operator_code} onPress={() => setOperator(o)} style={[styles.chip, operator?.operator_code === o.operator_code && styles.chipActive]}>
              <Text style={[typography.captionMedium, { color: operator?.operator_code === o.operator_code ? colors.white : colors.textSecondary }]}>{o.operator_name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Card>
        <Input label="Card Number" icon="card-outline" value={card} onChangeText={(t) => setCard(t.replace(/\s/g, ''))} keyboardType="number-pad" placeholder="Credit card number" />
        <Input label="Beneficiary Name" icon="person-outline" value={name} onChangeText={setName} placeholder="Card holder name" />
        <Input label="IFSC" icon="business-outline" value={ifsc} onChangeText={(t) => setIfsc(t.toUpperCase())} autoCapitalize="characters" placeholder="Card issuer IFSC" />
        <Input label="Bank Name" icon="business-outline" value={bankName} onChangeText={setBankName} placeholder="Issuer bank" />
        <Input label="Mobile" icon="call-outline" value={mobile} onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder="10-digit mobile" />
        <Input label="Amount (₹)" icon="cash-outline" value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" />
        {chargesQ.data && (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>Charge: {formatCurrency(chargesQ.data.charges?.total_charge)}</Text>
        )}
      </Card>

      <Button title={`Pay ${amt ? formatCurrency(amt) : ''}`} size="lg" fullWidth style={{ marginTop: spacing.lg }} disabled={!valid} onPress={() => setTpinOpen(true)} />
      <TpinSheet visible={tpinOpen} amount={amt} submitting={submitting} onCancel={() => setTpinOpen(false)} onConfirm={doPay} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  label: { ...typography.captionMedium, color: colors.textPrimary, marginBottom: spacing.sm },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.gray[100], marginRight: 8 },
  chipActive: { backgroundColor: colors.primary[600] },
});
