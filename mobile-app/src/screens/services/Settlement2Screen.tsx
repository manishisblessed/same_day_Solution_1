import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Alert, TouchableOpacity,
  Modal, ScrollView, KeyboardAvoidingView, Platform, TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Screen, Card, Input, Button, Pill, Loading, EmptyState, TpinSheet, Badge, TransactionReceiptModal, ReceiptData } from '@/components';
import {
  fetchSettlement2Accounts, fetchSettlement2Charges, settlement2Transfer,
  addSettlement2Account, deleteSettlement2Account, Settlement2Account,
} from '@/api/settlement2';
import { ApiError } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

// ── Add Account Full-Screen Modal ────────────────────────────────────────────
const AddAccountModal: React.FC<{ visible: boolean; onClose: () => void; onAdded: () => void }> = ({
  visible, onClose, onAdded,
}) => {
  const insets = useSafeAreaInsets();
  const [accNo, setAccNo] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setAccNo(''); setIfsc(''); setName(''); setMobile(''); };
  const close = () => { reset(); onClose(); };

  const save = async () => {
    if (accNo.length < 6) return Alert.alert('Invalid', 'Enter a valid account number.');
    if (ifsc.trim().length < 8) return Alert.alert('Invalid', 'Enter a valid IFSC code.');
    if (!name.trim()) return Alert.alert('Invalid', 'Enter the account holder name.');
    if (mobile.replace(/\D/g, '').length !== 10) return Alert.alert('Invalid', 'Enter a valid 10-digit mobile number.');
    setSaving(true);
    try {
      await addSettlement2Account({
        account_number: accNo.trim(),
        ifsc_code: ifsc.trim().toUpperCase(),
        account_holder_name: name.trim(),
        contact_mobile: mobile.replace(/\D/g, ''),
      });
      reset();
      onAdded();
    } catch (e) {
      Alert.alert('Failed to add', e instanceof ApiError ? e.message : 'Please try again.');
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
        {/* Header */}
        <View style={[styles.modalHeader, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity onPress={close} style={styles.backBtn} hitSlop={10}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[typography.h2, { color: colors.textPrimary, flex: 1 }]}>Add Settlement Account</Text>
        </View>

        <ScrollView
          contentContainerStyle={[styles.modalBody, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Input
            label="Account Number"
            icon="card-outline"
            value={accNo}
            onChangeText={(t) => setAccNo(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            placeholder="Beneficiary account number"
          />
          <Input
            label="IFSC Code"
            icon="business-outline"
            value={ifsc}
            onChangeText={(t) => setIfsc(t.toUpperCase())}
            autoCapitalize="characters"
            placeholder="e.g. HDFC0001234"
          />
          <Input
            label="Account Holder Name"
            icon="person-outline"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            placeholder="Full name as per bank"
          />
          <Input
            label="Contact Mobile"
            icon="call-outline"
            value={mobile}
            onChangeText={(t) => setMobile(t.replace(/\D/g, '').slice(0, 10))}
            keyboardType="number-pad"
            placeholder="10-digit mobile number"
          />
          <Button title="Save Account" size="lg" fullWidth loading={saving} onPress={save} style={{ marginTop: spacing.md }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ── Main Screen ──────────────────────────────────────────────────────────────
export const Settlement2Screen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Settlement2Account | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'IMPS' | 'RTGS'>('IMPS');
  const [tpinOpen, setTpinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const amt = parseFloat(amount) || 0;
  const accountsQ = useQuery({ queryKey: ['s2-accounts'], queryFn: fetchSettlement2Accounts });
  const chargesQ = useQuery({
    queryKey: ['s2-charges', amt, mode],
    queryFn: () => fetchSettlement2Charges(amt, mode),
    enabled: amt >= 1,
  });

  const allAccounts = accountsQ.data?.accounts ?? [];

  const accounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allAccounts;
    return allAccounts.filter((a) =>
      a.account_holder_name?.toLowerCase().includes(q) ||
      a.account_number?.includes(q) ||
      a.ifsc_code?.toLowerCase().includes(q)
    );
  }, [allAccounts, search]);

  const confirmDelete = (a: Settlement2Account) => {
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
              await deleteSettlement2Account(a.id);
              if (selected?.id === a.id) setSelected(null);
              qc.invalidateQueries({ queryKey: ['s2-accounts'] });
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
      const res = await settlement2Transfer({ account_id: selected.id, amount: amt, mode, tpin });
      setTpinOpen(false);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      const t = res.transaction;
      setReceipt({
        status: (t.status || '').toLowerCase() === 'success' ? 'success' : 'pending',
        service: 'Settlement-2',
        subService: `${mode} Transfer`,
        amount: t.amount ?? amt,
        accountNumber: selected?.account_number,
        bankName: selected?.ifsc_code,
        mode,
        utr: t.utr,
        referenceId: t.reference_id,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      setTpinOpen(false);
      setTimeout(() => Alert.alert('Failed', e instanceof ApiError ? e.message : 'Transfer failed.'), 350);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen title="Settlement-2" subtitle="Transfer to your bank" onBack={() => nav.goBack()} refreshing={accountsQ.isFetching} onRefresh={accountsQ.refetch}>
      <View style={styles.sectionRow}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>Select Account</Text>
        <TouchableOpacity style={styles.addBtn} activeOpacity={0.7} onPress={() => setAddOpen(true)}>
          <Ionicons name="add" size={16} color={colors.primary[600]} />
          <Text style={[typography.captionMedium, { color: colors.primary[600], marginLeft: 4 }]}>Add Account</Text>
        </TouchableOpacity>
      </View>

      {/* Search bar — only shown when there are accounts */}
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

      {accountsQ.isLoading ? (
        <Loading />
      ) : allAccounts.length === 0 ? (
        <Card>
          <EmptyState
            icon="business-outline"
            title="No settlement accounts"
            message="Tap 'Add Account' above to add your first bank account."
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
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{a.account_holder_name}</Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>{a.account_number} · {a.ifsc_code}</Text>
              </View>
              {a.verification_status ? (
                <Badge label={a.verification_status} tone={a.verification_status.toLowerCase() === 'success' ? 'success' : 'warning'} />
              ) : null}
              {selected?.id === a.id && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary[600]} style={{ marginLeft: 8 }} />
              )}
              {/* Delete button */}
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

      <Card style={{ marginTop: spacing.md }}>
        <Input label="Amount (₹)" icon="cash-outline" value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" />
        <View style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
          <Pill label="IMPS" active={mode === 'IMPS'} onPress={() => setMode('IMPS')} />
          <Pill label="RTGS" active={mode === 'RTGS'} onPress={() => setMode('RTGS')} />
        </View>
        {chargesQ.data && (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            Charges: {formatCurrency(chargesQ.data.charges?.retailer_charge)} · You transfer {formatCurrency(amt)}
          </Text>
        )}
      </Card>

      <Button title="Continue" size="lg" fullWidth style={{ marginTop: spacing.lg }} disabled={!selected || amt < 1} onPress={() => setTpinOpen(true)} />
      <TpinSheet visible={tpinOpen} amount={amt} submitting={submitting} onCancel={() => setTpinOpen(false)} onConfirm={doTransfer} />
      <TransactionReceiptModal visible={!!receipt} data={receipt} onDone={() => { setReceipt(null); nav.goBack(); }} />

      <AddAccountModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false);
          qc.invalidateQueries({ queryKey: ['s2-accounts'] });
          Alert.alert('Account added', 'Your settlement account has been added successfully.');
        }}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, marginBottom: spacing.sm },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary[50], paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full },
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
  deleteBtn: { marginLeft: 10, padding: 4 },
  fullScreen: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, paddingBottom: spacing.md, backgroundColor: colors.background },
  backBtn: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md, ...shadow.sm },
  modalBody: { paddingHorizontal: spacing.base, paddingTop: spacing.sm },
});
