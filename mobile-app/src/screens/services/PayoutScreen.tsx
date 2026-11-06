import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Alert, TouchableOpacity,
  Modal, ScrollView, KeyboardAvoidingView, Platform, TextInput, Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Screen, Card, Input, Button, Pill, Loading, EmptyState, TpinSheet, Badge, TransactionReceiptModal, ReceiptData } from '@/components';
import {
  fetchSettlement1Accounts, addSettlement1Account, deleteSettlement1Account,
  settlement1Transfer, fetchSettlement1Charges, Settlement1Account,
} from '@/api/settlement1';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/utils/format';

// ── Add Account Modal ─────────────────────────────────────────────────────────
type RegType = 'register' | 'verify';

const AddAccountModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
  userEmail: string;
}> = ({ visible, onClose, onAdded, userEmail }) => {
  const insets = useSafeAreaInsets();
  const [regType, setRegType] = useState<RegType>('register');
  const [accNo, setAccNo] = useState('');
  const [confirmAccNo, setConfirmAccNo] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [disclaimer, setDisclaimer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setAccNo(''); setConfirmAccNo(''); setIfsc(''); setName('');
    setMobile(''); setDisclaimer(false); setError('');
  };
  const close = () => { reset(); onClose(); };

  const save = async () => {
    setError('');
    if (accNo.length < 9) return setError('Enter a valid account number (min 9 digits).');
    if (accNo !== confirmAccNo) return setError('Account numbers do not match.');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifsc.trim())) return setError('Enter a valid IFSC code.');
    if (!/^[6-9]\d{9}$/.test(mobile)) return setError('Enter a valid 10-digit mobile number.');
    if (regType === 'register') {
      if (name.trim().length < 3) return setError('Account holder name must be at least 3 characters.');
      if (!disclaimer) return setError('Accept the disclaimer to proceed with free registration.');
    }
    setSaving(true);
    try {
      await addSettlement1Account({
        account_number: accNo.trim(),
        ifsc_code: ifsc.trim().toUpperCase(),
        mobile: mobile.trim(),
        email: userEmail,
        registration_type: regType,
        ...(regType === 'register' ? { account_holder_name: name.trim(), disclaimer_accepted: true } : {}),
      });
      reset();
      onAdded();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to add account. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.fullScreen, { backgroundColor: colors.background }]}
      >
        <View style={[styles.modalHeader, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity onPress={close} style={styles.backBtn} hitSlop={10}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[typography.h2, { color: colors.textPrimary, flex: 1 }]}>Add Bank Account</Text>
        </View>

        <ScrollView
          contentContainerStyle={[styles.modalBody, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Registration type selector */}
          <Card style={{ marginBottom: spacing.md }}>
            <Text style={[typography.captionMedium, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
              Registration Type
            </Text>
            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.regOption, regType === 'register' && styles.regOptionActive]}
              onPress={() => { setRegType('register'); setError(''); }}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color={regType === 'register' ? colors.primary[600] : colors.textSecondary} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text style={[typography.bodyMedium, { color: regType === 'register' ? colors.primary[700] : colors.textPrimary }]}>
                  Register (Free)
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  Add account with name declaration — no charge
                </Text>
              </View>
              {regType === 'register' && <Ionicons name="radio-button-on" size={18} color={colors.primary[600]} />}
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.regOption, { marginBottom: 0 }, regType === 'verify' && styles.regOptionActive]}
              onPress={() => { setRegType('verify'); setError(''); }}
            >
              <Ionicons name="shield-checkmark-outline" size={20} color={regType === 'verify' ? colors.success[600] : colors.textSecondary} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text style={[typography.bodyMedium, { color: regType === 'verify' ? colors.success[700] : colors.textPrimary }]}>
                  Verify via eKYC (₹4.72)
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  Bank-verified, holder name auto-fetched
                </Text>
              </View>
              {regType === 'verify' && <Ionicons name="radio-button-on" size={18} color={colors.success[600]} />}
            </TouchableOpacity>
          </Card>

          <Input
            label="Account Number"
            icon="card-outline"
            value={accNo}
            onChangeText={(t) => { setAccNo(t.replace(/\D/g, '')); setError(''); }}
            keyboardType="number-pad"
            placeholder="Beneficiary account number (min 9 digits)"
          />
          <Input
            label="Confirm Account Number"
            icon="card-outline"
            value={confirmAccNo}
            onChangeText={(t) => { setConfirmAccNo(t.replace(/\D/g, '')); setError(''); }}
            keyboardType="number-pad"
            placeholder="Re-enter account number"
          />
          <Input
            label="IFSC Code"
            icon="business-outline"
            value={ifsc}
            onChangeText={(t) => { setIfsc(t.toUpperCase()); setError(''); }}
            autoCapitalize="characters"
            placeholder="e.g. HDFC0001234"
          />

          {regType === 'register' && (
            <Input
              label="Account Holder Name"
              icon="person-outline"
              value={name}
              onChangeText={(t) => { setName(t); setError(''); }}
              autoCapitalize="words"
              placeholder="Full name as per bank records"
            />
          )}

          <Input
            label="Beneficiary Mobile"
            icon="call-outline"
            value={mobile}
            onChangeText={(t) => { setMobile(t.replace(/\D/g, '').slice(0, 10)); setError(''); }}
            keyboardType="number-pad"
            placeholder="10-digit mobile number"
          />

          {regType === 'register' && (
            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.disclaimerRow}
              onPress={() => { setDisclaimer((d) => !d); setError(''); }}
            >
              <Switch
                value={disclaimer}
                onValueChange={(v) => { setDisclaimer(v); setError(''); }}
                trackColor={{ false: colors.border, true: colors.primary[200] }}
                thumbColor={disclaimer ? colors.primary[600] : colors.gray[300]}
              />
              <Text style={[typography.caption, { color: colors.textSecondary, flex: 1, marginLeft: spacing.sm }]}>
                I confirm the account holder details are correct and I accept full responsibility for this free registration.
              </Text>
            </TouchableOpacity>
          )}

          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.danger[600]} />
              <Text style={[typography.caption, { color: colors.danger[700], flex: 1, marginLeft: 6 }]}>{error}</Text>
            </View>
          )}

          {regType === 'verify' && (
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.primary[600]} />
              <Text style={[typography.caption, { color: colors.primary[700], flex: 1, marginLeft: 6 }]}>
                ₹4.72 (₹4 + GST) will be deducted from your wallet for eKYC verification. The account holder name will be auto-filled from bank records.
              </Text>
            </View>
          )}

          <Button
            title={regType === 'verify' ? 'Verify & Add Account (₹4.72)' : 'Add Account (Free)'}
            size="lg"
            fullWidth
            loading={saving}
            onPress={save}
            style={{ marginTop: spacing.md }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ── Main Screen ───────────────────────────────────────────────────────────────
export const PayoutScreen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [selected, setSelected] = useState<Settlement1Account | null>(null);
  const [amount, setAmount] = useState('');
  const mode = 'IMPS' as const; // Knteer primarily supports IMPS
  const [tpinOpen, setTpinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const amt = parseFloat(amount) || 0;

  const accountsQ = useQuery({ queryKey: ['s1-accounts'], queryFn: fetchSettlement1Accounts });
  const chargesQ = useQuery({
    queryKey: ['s1-charges', amt],
    queryFn: () => fetchSettlement1Charges(amt),
    enabled: amt >= 1,
  });

  const allAccounts = accountsQ.data?.accounts ?? [];
  const accounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allAccounts;
    return allAccounts.filter((a) =>
      a.account_holder_name?.toLowerCase().includes(q) ||
      a.account_number?.includes(q) ||
      a.ifsc_code?.toLowerCase().includes(q) ||
      a.bank_name?.toLowerCase().includes(q)
    );
  }, [allAccounts, search]);

  const confirmDelete = (a: Settlement1Account) => {
    Alert.alert(
      'Delete Account',
      `Remove ${a.account_holder_name} (${a.account_number})?\nThis cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setDeleting(a.id);
            try {
              await deleteSettlement1Account(a.id);
              if (selected?.id === a.id) setSelected(null);
              qc.invalidateQueries({ queryKey: ['s1-accounts'] });
            } catch {
              Alert.alert('Failed', 'Could not delete account. Please try again.');
            } finally {
              setDeleting(null);
            }
          },
        },
      ]
    );
  };

  const doTransfer = async (tpin: string) => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await settlement1Transfer({
        accountNumber: selected.account_number,
        ifscCode: selected.ifsc_code,
        accountHolderName: selected.account_holder_name,
        bankName: selected.bank_name || '',
        amount: amt,
        paymentMode: mode,
        mobile: selected.mobile || '',
        email: user?.email || '',
        senderName: user?.name || '',
        senderMobile: user?.phone || '',
        tpin,
      });
      setTpinOpen(false);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      const st = (res.status || '').toLowerCase();
      setReceipt({
        status: st === 'success' ? 'success' : st === 'failed' ? 'failed' : 'pending',
        service: 'Settlement-1',
        subService: `${mode} Transfer`,
        amount: res.amount ?? amt,
        charges: res.charges,
        transactionId: res.transaction_id,
        referenceId: res.partner_trans_id,
        utr: res.utr,
        customerName: selected.account_holder_name,
        accountNumber: selected.account_number,
        bankName: selected.bank_name || selected.ifsc_code,
        mode,
        message: st === 'pending' ? 'Transfer is being processed. Check status in a few minutes.' : undefined,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      setTpinOpen(false);
      const msg = e instanceof ApiError ? e.message : 'Transfer failed. Please try again.';
      // Warn on timeout — transfer may have gone through
      if (msg.includes('504') || msg.includes('timeout') || msg.includes('Gateway Time')) {
        setTimeout(() => Alert.alert(
          'Request timed out',
          'This does not mean the transfer failed. Check your transaction history in 2–3 minutes before retrying.',
        ), 350);
      } else {
        setTimeout(() => Alert.alert('Transfer failed', msg), 350);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const chargeAmt = chargesQ.data?.charges?.retailer_charge;
  const chargeUnavailable = chargesQ.data?.scheme_assigned === false;

  return (
    <Screen
      title="Settlement-1"
      subtitle="Bank transfer via Knteer"
      onBack={() => nav.goBack()}
      refreshing={accountsQ.isRefetching}
      onRefresh={accountsQ.refetch}
    >
      {/* Section header */}
      <View style={styles.sectionRow}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>Select Account</Text>
        <TouchableOpacity style={styles.addBtn} activeOpacity={0.7} onPress={() => setAddOpen(true)}>
          <Ionicons name="add" size={16} color={colors.primary[600]} />
          <Text style={[typography.captionMedium, { color: colors.primary[600], marginLeft: 4 }]}>Add Account</Text>
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      {allAccounts.length > 0 && (
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, account no., IFSC…"
            placeholderTextColor={colors.textSecondary}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Accounts list */}
      {accountsQ.isLoading ? (
        <Loading />
      ) : allAccounts.length === 0 ? (
        <Card>
          <EmptyState
            icon="business-outline"
            title="No accounts added"
            message="Tap 'Add Account' to register your first bank account for Settlement-1."
          />
        </Card>
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState icon="search-outline" title="No results" message={`No account matches "${search}".`} />
        </Card>
      ) : (
        accounts.map((a) => (
          <TouchableOpacity key={a.id} activeOpacity={0.7} onPress={() => setSelected(a)}>
            <Card style={[styles.acc, selected?.id === a.id && styles.accActive]}>
              {/* Account icon */}
              <View style={styles.accIcon}>
                <Ionicons name="business" size={18} color={colors.primary[600]} />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{a.account_holder_name}</Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  {a.account_number} · {a.bank_name || a.ifsc_code}
                </Text>
              </View>
              {/* Verification badge */}
              {a.is_bank_verified ? (
                <Badge label="Verified" tone="success" />
              ) : a.is_registered ? (
                <Badge label="Registered" tone="warning" />
              ) : null}
              {selected?.id === a.id && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary[600]} style={{ marginLeft: 8 }} />
              )}
              {/* Delete */}
              <TouchableOpacity
                onPress={() => confirmDelete(a)}
                disabled={deleting === a.id}
                hitSlop={8}
                style={styles.deleteBtn}
              >
                <Ionicons
                  name={deleting === a.id ? 'hourglass-outline' : 'trash-outline'}
                  size={18}
                  color={deleting === a.id ? colors.textSecondary : colors.danger[500]}
                />
              </TouchableOpacity>
            </Card>
          </TouchableOpacity>
        ))
      )}

      {/* Amount + charges */}
      <Card style={{ marginTop: spacing.md }}>
        <Input
          label="Amount (₹)"
          icon="cash-outline"
          value={amount}
          onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />
        <View style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
          <Pill label="IMPS (instant)" active />
        </View>
        {chargeUnavailable && (
          <Text style={[typography.caption, { color: colors.warning[600] }]}>
            Scheme not assigned. Contact support before transferring.
          </Text>
        )}
        {chargeAmt != null && chargeAmt > 0 && (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            Charges: {formatCurrency(chargeAmt)} · You transfer {formatCurrency(amt)}
          </Text>
        )}
        {chargeAmt === 0 && (
          <Text style={[typography.caption, { color: colors.success[600] }]}>
            No charges applicable
          </Text>
        )}
      </Card>

      <Button
        title={`Transfer ${amt ? formatCurrency(amt) : ''}`}
        size="lg"
        fullWidth
        style={{ marginTop: spacing.lg }}
        disabled={!selected || amt < 1}
        onPress={() => setTpinOpen(true)}
      />

      <TpinSheet visible={tpinOpen} amount={amt} submitting={submitting} onCancel={() => setTpinOpen(false)} onConfirm={doTransfer} />
      <TransactionReceiptModal visible={!!receipt} data={receipt} onDone={() => { setReceipt(null); nav.goBack(); }} />

      <AddAccountModal
        visible={addOpen}
        userEmail={user?.email || ''}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false);
          qc.invalidateQueries({ queryKey: ['s1-accounts'] });
          Alert.alert('Account added', 'Bank account has been registered successfully.');
        }}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.primary[50], paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 10,
    marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.textPrimary, padding: 0 },
  acc: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  accActive: { borderWidth: 1.5, borderColor: colors.primary[400] },
  accIcon: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center',
  },
  deleteBtn: { marginLeft: 10, padding: 4 },

  // Add account modal
  fullScreen: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.base, paddingBottom: spacing.md,
    backgroundColor: colors.background,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md, ...shadow.sm,
  },
  modalBody: { paddingHorizontal: spacing.base, paddingTop: spacing.sm },
  regOption: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: spacing.sm, borderRadius: radius.md, marginBottom: spacing.sm,
    backgroundColor: colors.gray[50],
  },
  regOptionActive: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200] },
  disclaimerRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.warning[50], borderRadius: radius.md,
    padding: spacing.sm, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.warning[100],
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.danger[50], borderRadius: radius.md,
    padding: spacing.sm, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.danger[100],
  },
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.primary[50], borderRadius: radius.md,
    padding: spacing.sm, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.primary[100],
  },
});
