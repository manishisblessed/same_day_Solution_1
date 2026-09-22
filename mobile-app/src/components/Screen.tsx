import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, StyleProp, ViewStyle, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';

export const Screen: React.FC<{
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  padded?: boolean;
}> = ({ children, title, subtitle, onBack, right, scroll = true, refreshing, onRefresh, contentStyle, padded = true }) => {
  const insets = useSafeAreaInsets();
  const header = title ? (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <View style={styles.headerRow}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[typography.h2, { color: colors.textPrimary }]} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  ) : (
    <View style={{ height: insets.top }} />
  );

  const body = (
    <View style={[padded && { paddingHorizontal: spacing.base }, contentStyle]}>{children}</View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      {header}
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingTop: spacing.sm }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} /> : undefined}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.base, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { marginRight: 6, marginLeft: -6 },
});
