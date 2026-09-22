import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { Screen, Card, Input, Button, Loading, EmptyState, Badge, statusTone } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { getDeviceFingerprint } from '@/lib/device';
import { captureFingerprint, isBiometricSupported, BiometricError } from '@/aeps/mantra';
import { aepsLoginStatus, aepsLogin, aepsTransact, AepsTxnType, AepsBank, AepsReceipt } from '@/api/aeps';
import { ApiError } from '@/lib/api';
import { formatCurrency, maskAadhaar } from '@/utils/format';

const TXN_TYPES: { key: AepsTxnType; label: string; icon: string; needsAmount?: boolean }[] = [
  { key: 'cash_withdrawal', label: 'Cash Withdrawal', icon: 'cash', needsAmount: true },
  { key: 'balance_inquiry', label: 'Balance Enquiry', icon: 'wallet' },
  { key: 'mini_statement', label: 'Mini Statement', icon: 'list' },
  { key: 'aadhaar_to_aadhaar', label: 'Aadhaar Pay', icon: 'card', needsAmount: true },
];

export const AepsScreen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const merchantId = user?.partner_id || '';
  const [df, setDf] = useState('');
  const [txnType, setTxnType] = useState<AepsTxnType>('cash_withdrawal');
  const [bank, setBank] = useState<AepsBank | null>(null);
  const [aadhaar, setAadhaar] = useState('');
  const [mobile, setMobile] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<AepsReceipt | null>(null);

  useEffect(() => { getDeviceFingerprint().then(setDf); }, []);

  const statusQ = useQuery({
    queryKey: ['aeps-status', merchantId, df],
    queryFn: () => aepsLoginStatus({ merchantId, type: 'withdraw', deviceFingerprint: df }),
    enabled: !!merchantId && !!df && isBiometricSupported(),
  });

  const status = statusQ.data?.data;
  const banks = status?.bankList ?? [];
  const wadh = status?.wadh ?? '';
  const loggedIn = !!status?.loginStatus;
  const kycOk = (status?.kycStatus ?? '').toLowerCase() === 'validated';

  useEffect(() => { if (banks.length && !bank) setBank(banks[0]); }, [banks, bank]);

  if (!isBiometricSupported()) {
    return (
      <Screen title="AEPS" subtitle="Aadhaar banking" onBack={() => nav.goBack()}>
        <Card style={{ marginTop: spacing.lg }}>
          <EmptyState icon="phone-portrait-outline" title="Android only" message="AEPS with the Mantra L1 fingerprint device is supported on Android only. Please use an Android phone with the Mantra RD Service installed." />
        </Card>
      </Screen>
    );
  }

  const dailyLogin = async () => {
    setBusy(true);
    try {
      const bio = await captureFingerprint(wadh);
      const res = await aepsLogin({ merchantId, transType: 'withdraw', wadh, deviceFingerprint: df, bio });
      if (res.success) {
        await statusQ.refetch();
        Alert.alert('Logged in', 'Daily AEPS authentication successful.');
      } else if (res.retry) {
        Alert.alert('Retry', res.message || 'Please try again.');
      } else {
        Alert.alert('Login failed', res.message || 'Could not authenticate.');
      }
    } catch (e) {
      handleBioError(e);
    } finally {
      setBusy(false);
    }
  };

  const runTxn = async () => {
    if (!bank) return Alert.alert('Select bank', 'Choose the customer bank.');
    if (aadhaar.replace(/\D/g, '').length !== 12) return Alert.alert('Aadhaar', 'Enter a valid 12-digit Aadhaar.');
    if (mobile.length !== 10) return Alert.alert('Mobile', 'Enter a valid 10-digit mobile.');
    const needsAmount = TXN_TYPES.find((t) => t.key === txnType)?.needsAmount;
    const amt = parseFloat(amount) || 0;
    if (needsAmount && amt < 1) return Alert.alert('Amount', 'Enter a valid amount.');

    setBusy(true);
    setReceipt(null);
    try {
      const bio = await captureFingerprint(wadh);
      const res = await aepsTransact({
        merchantId,
        transactionType: txnType,
        customerAadhaar: aadhaar.replace(/\D/g, ''),
        customerMobile: mobile,
        bankIin: bank.iin,
        bankName: bank.bankName,
        amount: needsAmount ? amt : undefined,
        wadh,
        deviceFingerprint: df,
        biometricData: bio,
      });
      qc.invalidateQueries({ queryKey: ['wallet'] });
      setReceipt(res.receipt);
    } catch (e) {
      handleBioError(e);
    } finally {
      setBusy(false);
    }
  };

  const handleBioError = (e: any) => {
    if (e instanceof BiometricError) {
      Alert.alert('Fingerprint', e.message);
    } else if (e instanceof ApiError) {
      if (e.code === 'DEVICE_CHANGED' || e.code === 'IP_CHANGED' || e.code === 'SESSION_2FA_EXPIRED') {
        Alert.alert('Re-authenticate', e.message, [{ text: 'OK', onPress: () => statusQ.refetch() }]);
      } else {
        Alert.alert('Transaction failed', e.message);
      }
    } else {
      Alert.alert('Error', e?.message || 'Something went wrong.');
    }
  };

  if (receipt) return <ReceiptView receipt={receipt} onDone={() => { setReceipt(null); }} onClose={() => nav.goBack()} />;

  return (
    <Screen title="AEPS" subtitle="Aadhaar banking" onBack={() => nav.goBack()} refreshing={statusQ.isFetching} onRefresh={statusQ.refetch}>
      {statusQ.isLoading ? (
        <Loading label="Checking AEPS session…" />
      ) : !kycOk ? (
        <Card style={{ marginTop: spacing.lg }}>
          <EmptyState icon="shield-outline" title="Complete AEPS KYC" message="Your AEPS operator onboarding/KYC is not validated yet. Please complete it on the web portal, then return here." />
        </Card>
      ) : !loggedIn ? (
        <Card style={{ marginTop: spacing.lg, alignItems: 'center', paddingVertical: spacing.xl }}>
          <View style={styles.fpCircle}><Ionicons name="finger-print" size={40} color={colors.primary[600]} /></View>
          <Text style={[typography.h3, { color: colors.textPrimary, marginTop: spacing.md }]}>Daily Authentication</Text>
          <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 }]}>
            Scan your fingerprint on the Mantra device to start AEPS for today.
          </Text>
          <Button title="Authenticate with Fingerprint" icon="finger-print" size="lg" fullWidth loading={busy} style={{ marginTop: spacing.lg }} onPress={dailyLogin} />
        </Card>
      ) : (
        <>
          <View style={styles.sessionRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success[600]} />
            <Text style={[typography.caption, { color: colors.success[700], marginLeft: 6 }]}>AEPS session active</Text>
          </View>

          <Text style={styles.label}>Transaction Type</Text>
          <View style={styles.typeGrid}>
            {TXN_TYPES.map((t) => (
              <TouchableOpacity key={t.key} style={[styles.typeItem, txnType === t.key && styles.typeActive]} onPress={() => setTxnType(t.key)}>
                <Ionicons name={t.icon as any} size={20} color={txnType === t.key ? colors.white : colors.primary[600]} />
                <Text style={[typography.small, { color: txnType === t.key ? colors.white : colors.textSecondary, marginTop: 4, fontWeight: '600' }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Card style={{ marginTop: spacing.md }}>
            <Text style={styles.label}>Customer Bank</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
              {banks.map((b) => (
                <TouchableOpacity key={b.iin} onPress={() => setBank(b)} style={[styles.bankChip, bank?.iin === b.iin && styles.bankChipActive]}>
                  <Text style={[typography.small, { color: bank?.iin === b.iin ? colors.white : colors.textSecondary, fontWeight: '600' }]} numberOfLines={1}>{b.bankName}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Input label="Customer Aadhaar" icon="id-card-outline" value={aadhaar} onChangeText={(t) => setAadhaar(t.replace(/\D/g, '').slice(0, 12))} keyboardType="number-pad" placeholder="12-digit Aadhaar" />
            <Input label="Customer Mobile" icon="call-outline" value={mobile} onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder="10-digit mobile" />
            {TXN_TYPES.find((t) => t.key === txnType)?.needsAmount && (
              <Input label="Amount (₹)" icon="cash-outline" value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="Multiple of ₹100 (₹100–₹10,000)" />
            )}
          </Card>

          <Button title="Scan Fingerprint & Proceed" icon="finger-print" size="lg" fullWidth loading={busy} style={{ marginTop: spacing.lg }} onPress={runTxn} />
        </>
      )}
    </Screen>
  );
};

const ReceiptView: React.FC<{ receipt: AepsReceipt; onDone: () => void; onClose: () => void }> = ({ receipt, onDone, onClose }) => {
  const ok = receipt.status === 'SUCCESS';
  return (
    <Screen title="AEPS Receipt" onBack={onClose}>
      <Card style={{ marginTop: spacing.lg, alignItems: 'center', paddingVertical: spacing.xl }}>
        <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={64} color={ok ? colors.success[500] : colors.danger[500]} />
        <View style={{ marginTop: 8 }}><Badge label={receipt.status} tone={statusTone(receipt.status)} /></View>
        {receipt.transaction?.amount != null && (
          <Text style={[typography.display, { color: colors.textPrimary, marginTop: spacing.md }]}>{formatCurrency(receipt.transaction.amount)}</Text>
        )}
        {receipt.bank?.availableBalance != null && (
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4 }]}>Available Balance: {formatCurrency(receipt.bank.availableBalance)}</Text>
        )}
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        {receipt.customer?.bankName ? <Detail label="Bank" value={receipt.customer.bankName} /> : null}
        {receipt.customer?.aadhaarMasked ? <Detail label="Aadhaar" value={receipt.customer.aadhaarMasked} /> : null}
        {receipt.utr ? <Detail label="UTR / RRN" value={receipt.utr} /> : null}
        <Detail label="Txn ID" value={receipt.txnId} />
        {receipt.error?.errorMessage ? <Detail label="Message" value={receipt.error.errorMessage} /> : null}
      </Card>

      {receipt.miniStatement && receipt.miniStatement.length > 0 && (
        <Card style={{ marginTop: spacing.md }} padded={false}>
          <Text style={[typography.h3, { color: colors.textPrimary, padding: spacing.base }]}>Mini Statement</Text>
          {receipt.miniStatement.map((m, i) => (
            <View key={i} style={styles.msRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.caption, { color: colors.textPrimary }]} numberOfLines={1}>{m.narration}</Text>
                <Text style={[typography.small, { color: colors.textMuted }]}>{m.date}</Text>
              </View>
              <Text style={[typography.captionMedium, { color: m.txnType === 'Cr' ? colors.success[600] : colors.textPrimary }]}>{m.txnType} {m.amount}</Text>
            </View>
          ))}
        </Card>
      )}

      <Button title="New Transaction" fullWidth size="lg" style={{ marginTop: spacing.lg }} onPress={onDone} />
    </Screen>
  );
};

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.detailRow}>
    <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
    <Text style={[typography.captionMedium, { color: colors.textPrimary, flexShrink: 1, textAlign: 'right' }]} numberOfLines={1}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  fpCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  sessionRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.success[50], paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.base, marginTop: spacing.sm, alignSelf: 'flex-start' },
  label: { ...typography.captionMedium, color: colors.textPrimary, marginBottom: spacing.sm },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeItem: { width: '48%', flexDirection: 'column', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.base, paddingVertical: spacing.base, borderWidth: 1, borderColor: colors.border },
  typeActive: { backgroundColor: colors.primary[600], borderColor: colors.primary[600] },
  bankChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.gray[100], marginRight: 8, maxWidth: 180 },
  bankChipActive: { backgroundColor: colors.primary[600] },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  msRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
