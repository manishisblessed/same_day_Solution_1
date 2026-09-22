import React, { useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { Button } from './ui';

/**
 * Collects the 4-digit TPIN required by every money-moving endpoint
 * (payout, bbps/pay, settlement-2, rechargekit, pay2new).
 */
export const TpinSheet: React.FC<{
  visible: boolean;
  amount?: number;
  title?: string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (tpin: string) => void;
}> = ({ visible, amount, title = 'Enter TPIN', submitting, onCancel, onConfirm }) => {
  const [tpin, setTpin] = useState('');
  const digits = tpin.padEnd(4, ' ').split('');

  const press = (n: string) => {
    if (tpin.length < 4) setTpin(tpin + n);
  };
  const back = () => setTpin(tpin.slice(0, -1));

  const close = () => {
    setTpin('');
    onCancel();
  };
  const confirm = () => {
    if (tpin.length === 4) {
      onConfirm(tpin);
      setTpin('');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <TouchableWithoutFeedback onPress={close}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Ionicons name="shield-checkmark" size={22} color={colors.primary[600]} />
          <Text style={[typography.h3, { color: colors.textPrimary, marginLeft: 8 }]}>{title}</Text>
        </View>
        {amount != null && (
          <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.base }]}>
            Authorize ₹{amount.toLocaleString('en-IN')} transaction
          </Text>
        )}
        <View style={styles.dots}>
          {digits.map((d, i) => (
            <View key={i} style={[styles.dot, tpin.length > i && styles.dotFilled]}>
              {tpin.length > i ? <View style={styles.dotInner} /> : null}
            </View>
          ))}
        </View>
        <View style={styles.keypad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'].map((k, i) => {
            if (k === '') return <View key={i} style={styles.key} />;
            if (k === 'back') {
              return (
                <TouchableOpacity key={i} style={styles.key} onPress={back}>
                  <Ionicons name="backspace-outline" size={24} color={colors.textPrimary} />
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity key={i} style={styles.key} onPress={() => press(k)} activeOpacity={0.6}>
                <Text style={styles.keyText}>{k}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Button
          title="Confirm & Pay"
          fullWidth
          size="lg"
          loading={submitting}
          disabled={tpin.length !== 4}
          onPress={confirm}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'],
    padding: spacing.lg, paddingBottom: spacing['2xl'],
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300], marginBottom: spacing.base },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginVertical: spacing.lg },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.gray[300], alignItems: 'center', justifyContent: 'center' },
  dotFilled: { borderColor: colors.primary[600] },
  dotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary[600] },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.lg },
  key: { width: '33.33%', height: 58, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 24, fontWeight: '600', color: colors.textPrimary },
});
