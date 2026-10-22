/**
 * TransactionReceiptModal — full-screen receipt shown after every transaction.
 * Replaces the basic Alert.alert "Done" prompt across all service screens.
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, ScrollView, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { formatCurrency } from '@/utils/format';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ReceiptData {
  status: 'success' | 'pending' | 'failed';
  service: string;           // e.g. "Mobile Prepaid"
  subService?: string;       // e.g. "Airtel" / "HDFC0001234"
  amount: number;
  charges?: number;
  orderId?: string;
  referenceId?: string;
  operatorRef?: string;
  utr?: string;
  transactionId?: string;
  customerName?: string;
  accountNumber?: string;
  bankName?: string;
  mode?: string;             // IMPS / RTGS / NEFT
  message?: string;
  timestamp?: string;        // ISO — defaults to now
}

export interface TransactionReceiptModalProps {
  visible: boolean;
  data: ReceiptData | null;
  onDone: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  success: { icon: 'checkmark-circle' as const, bg: '#DCFCE7', color: '#16A34A', label: 'Successful' },
  pending: { icon: 'time'             as const, bg: '#FEF9C3', color: '#CA8A04', label: 'Pending'    },
  failed:  { icon: 'close-circle'     as const, bg: '#FEE2E2', color: '#DC2626', label: 'Failed'     },
};

function fmtDate(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Receipt line ──────────────────────────────────────────────────────────────
function Row({ label, value, bold, mono }: { label: string; value?: string | null; bold?: boolean; mono?: boolean }) {
  if (!value) return null;
  return (
    <View style={st.row}>
      <Text style={st.rowLabel}>{label}</Text>
      <Text style={[st.rowValue, bold && { fontWeight: '700' }, mono && st.mono]} selectable>{value}</Text>
    </View>
  );
}

// ── Download receipt ──────────────────────────────────────────────────────────
async function downloadReceipt(d: ReceiptData) {
  const cfg = STATUS_CONFIG[d.status];
  const ts = fmtDate(d.timestamp);
  const lines = [
    '========================================',
    '         TRANSACTION RECEIPT',
    '========================================',
    `Status   : ${cfg.label.toUpperCase()}`,
    `Date     : ${ts}`,
    '----------------------------------------',
    `Service  : ${d.service}${d.subService ? ' / ' + d.subService : ''}`,
    `Amount   : ${formatCurrency(d.amount)}`,
    d.charges != null ? `Charges  : ${formatCurrency(d.charges)}` : null,
    d.charges != null ? `Total    : ${formatCurrency(d.amount + d.charges)}` : null,
    '----------------------------------------',
    d.customerName   ? `Customer : ${d.customerName}`    : null,
    d.accountNumber  ? `Account  : ${d.accountNumber}`   : null,
    d.bankName       ? `Bank     : ${d.bankName}`         : null,
    d.mode           ? `Mode     : ${d.mode}`             : null,
    '----------------------------------------',
    d.orderId        ? `Order ID : ${d.orderId}`          : null,
    d.transactionId  ? `Txn ID   : ${d.transactionId}`   : null,
    d.referenceId    ? `Ref      : ${d.referenceId}`      : null,
    d.utr            ? `UTR      : ${d.utr}`              : null,
    d.operatorRef    ? `Op Ref   : ${d.operatorRef}`      : null,
    '========================================',
    d.message ? `Note: ${d.message}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const filename = `receipt_${(d.orderId || d.transactionId || Date.now()).toString().slice(-10)}`;

  let FileSystem: any = null;
  try { FileSystem = await import('expo-file-system/legacy'); } catch { /* no FS */ }

  if (Platform.OS === 'android' && FileSystem?.StorageAccessFramework) {
    try {
      const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (perm.granted) {
        const uri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri, filename, 'text/plain'
        );
        await FileSystem.writeAsStringAsync(uri, lines, { encoding: FileSystem.EncodingType.UTF8 });
        Alert.alert('Receipt Downloaded', `"${filename}.txt" saved to the selected folder.`);
        return;
      }
    } catch { /* fall through */ }
  }

  if (FileSystem?.documentDirectory) {
    try {
      await FileSystem.writeAsStringAsync(
        `${FileSystem.documentDirectory}${filename}.txt`, lines,
        { encoding: FileSystem.EncodingType.UTF8 }
      );
      Alert.alert('Receipt Saved', `"${filename}.txt" saved to app storage.`);
      return;
    } catch { /* fall through */ }
  }

  // Last resort: share as text
  const { Share } = require('react-native');
  await Share.share({ message: lines, title: filename });
}

// ── Component ─────────────────────────────────────────────────────────────────
export function TransactionReceiptModal({ visible, data, onDone }: TransactionReceiptModalProps) {
  const insets = useSafeAreaInsets();
  if (!data) return null;

  const cfg = STATUS_CONFIG[data.status];
  const total = data.charges != null ? data.amount + data.charges : null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onDone}>
      <View style={[st.container, { paddingTop: insets.top }]}>
        <ScrollView
          contentContainerStyle={[st.scroll, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Status badge ── */}
          <View style={[st.statusCircle, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon} size={56} color={cfg.color} />
          </View>
          <Text style={[typography.h2, st.statusLabel, { color: cfg.color }]}>
            {data.service} {cfg.label}
          </Text>
          <Text style={[typography.h1, st.amountText]}>{formatCurrency(data.amount)}</Text>
          <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.lg }]}>
            {fmtDate(data.timestamp)}
          </Text>

          {/* ── Receipt card ── */}
          <View style={st.card}>
            {/* Status row */}
            <View style={[st.statusTag, { backgroundColor: cfg.bg }]}>
              <Ionicons name={cfg.icon} size={14} color={cfg.color} style={{ marginRight: 4 }} />
              <Text style={[typography.captionMedium, { color: cfg.color }]}>{cfg.label.toUpperCase()}</Text>
            </View>

            <View style={st.divider} />

            {/* Transaction fields */}
            <Row label="Service"     value={data.service} />
            <Row label="Provider"    value={data.subService} />
            <Row label="Customer"    value={data.customerName} />
            <Row label="Account"     value={data.accountNumber} />
            <Row label="Bank"        value={data.bankName} />
            <Row label="Mode"        value={data.mode} />

            <View style={st.divider} />

            <Row label="Amount"      value={formatCurrency(data.amount)} bold />
            {data.charges != null && (
              <Row label="Charges"   value={formatCurrency(data.charges)} />
            )}
            {total != null && (
              <Row label="Total Paid" value={formatCurrency(total)} bold />
            )}

            <View style={st.divider} />

            <Row label="Order ID"    value={data.orderId}       mono />
            <Row label="Txn ID"      value={data.transactionId} mono />
            <Row label="Reference"   value={data.referenceId}   mono />
            <Row label="UTR"         value={data.utr}           mono />
            <Row label="Op. Ref"     value={data.operatorRef}   mono />

            {data.message ? (
              <>
                <View style={st.divider} />
                <View style={st.noteBox}>
                  <Ionicons name="information-circle-outline" size={15} color={colors.warning[600]} style={{ marginRight: 6 }} />
                  <Text style={[typography.caption, { color: colors.warning[600], flex: 1 }]}>{data.message}</Text>
                </View>
              </>
            ) : null}
          </View>

          {/* ── Actions ── */}
          <TouchableOpacity style={st.downloadBtn} onPress={() => downloadReceipt(data)} activeOpacity={0.8}>
            <Ionicons name="download-outline" size={18} color={colors.primary[600]} style={{ marginRight: 8 }} />
            <Text style={[typography.bodyMedium, { color: colors.primary[600] }]}>Download Receipt</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[st.doneBtn, { backgroundColor: cfg.color }]} onPress={onDone} activeOpacity={0.85}>
            <Text style={[typography.bodyMedium, { color: '#fff' }]}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { alignItems: 'center', paddingHorizontal: spacing.base, paddingTop: spacing.xl },

  statusCircle: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  statusLabel: { marginBottom: 4, textAlign: 'center' },
  amountText: { fontSize: 34, fontWeight: '800', color: colors.textPrimary, marginBottom: 4 },

  card: {
    width: '100%', backgroundColor: colors.white,
    borderRadius: radius.xl, padding: spacing.base,
    marginBottom: spacing.md, ...shadow.lg,
  },
  statusTag: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full,
    marginBottom: spacing.sm,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },

  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', paddingVertical: 5,
  },
  rowLabel: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  rowValue: { ...typography.caption, color: colors.textPrimary, flex: 1.8, textAlign: 'right' },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 11 },

  noteBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#FFFBEB', borderRadius: radius.base, padding: spacing.sm,
  },

  downloadBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.primary[400],
    borderRadius: radius.md, paddingVertical: 13,
    backgroundColor: colors.primary[50], marginBottom: spacing.sm,
  },
  doneBtn: {
    width: '100%', alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, paddingVertical: 14,
    marginBottom: spacing.sm,
  },
});
