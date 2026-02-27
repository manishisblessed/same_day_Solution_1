import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, borderRadius, shadow } from '../theme';
import { Card, Badge, ListItem, Button } from '../components';
import { retailerProfile } from '../data/dummy';
import { useAuth } from '../navigation/AuthContext';
import { getInitials, formatDate } from '../utils';

interface ProfileFieldProps {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  masked?: boolean;
}

const ProfileField: React.FC<ProfileFieldProps> = ({ label, value, icon }) => (
  <View style={styles.fieldRow}>
    <View style={styles.fieldIcon}>
      <Ionicons name={icon} size={18} color={colors.primary[500]} />
    </View>
    <View style={styles.fieldContent}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  </View>
);

export const ProfileScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: logout },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <LinearGradient
        colors={[colors.primary[600], colors.primary[700]]}
        style={[styles.headerGradient, { paddingTop: insets.top + 12 }]}
      >
        <Text style={styles.headerTitle}>Profile</Text>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarLargeText}>
              {getInitials(retailerProfile.name)}
            </Text>
          </View>
          <Text style={styles.profileName}>{retailerProfile.name}</Text>
          <Text style={styles.shopName}>{retailerProfile.shopName}</Text>

          <View style={styles.badgeRow}>
            <Badge label="Retailer" variant="info" size="md" />
            <Badge
              label={
                retailerProfile.kycStatus === 'verified'
                  ? 'KYC Verified'
                  : 'KYC Pending'
              }
              variant={
                retailerProfile.kycStatus === 'verified' ? 'success' : 'warning'
              }
              size="md"
            />
          </View>

          <View style={styles.partnerIdRow}>
            <Ionicons name="id-card-outline" size={16} color={colors.textMuted} />
            <Text style={styles.partnerId}>{retailerProfile.partnerId}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <Card style={styles.fieldCard}>
            <ProfileField
              label="Email Address"
              value={retailerProfile.email}
              icon="mail-outline"
            />
            <ProfileField
              label="Phone Number"
              value={retailerProfile.phone}
              icon="call-outline"
            />
            <ProfileField
              label="PAN Number"
              value={retailerProfile.panNumber}
              icon="document-text-outline"
            />
            <ProfileField
              label="Aadhaar Number"
              value={retailerProfile.aadharNumber}
              icon="shield-checkmark-outline"
            />
          </Card>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Address</Text>
          <Card style={styles.fieldCard}>
            <ProfileField
              label="Address"
              value={retailerProfile.address}
              icon="location-outline"
            />
            <ProfileField
              label="City"
              value={`${retailerProfile.city}, ${retailerProfile.state}`}
              icon="business-outline"
            />
            <ProfileField
              label="Pincode"
              value={retailerProfile.pincode}
              icon="navigate-outline"
            />
          </Card>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bank Details</Text>
          <Card style={styles.fieldCard}>
            <ProfileField
              label="Bank Name"
              value={retailerProfile.bankName}
              icon="business-outline"
            />
            <ProfileField
              label="Account Number"
              value={retailerProfile.bankAccountNumber}
              icon="card-outline"
            />
            <ProfileField
              label="IFSC Code"
              value={retailerProfile.bankIfsc}
              icon="git-branch-outline"
            />
          </Card>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business</Text>
          <Card style={styles.fieldCard}>
            <ProfileField
              label="Distributor"
              value={retailerProfile.distributorName}
              icon="people-outline"
            />
            <ProfileField
              label="Member Since"
              value={formatDate(retailerProfile.createdAt)}
              icon="calendar-outline"
            />
          </Card>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <Card padding={0}>
            <ListItem
              title="Notification Preferences"
              leftIcon={
                <View style={[styles.settingsIcon, { backgroundColor: colors.primary[50] }]}>
                  <Ionicons name="notifications-outline" size={18} color={colors.primary[600]} />
                </View>
              }
              showChevron
              onPress={() => {}}
            />
            <ListItem
              title="Security & TPIN"
              leftIcon={
                <View style={[styles.settingsIcon, { backgroundColor: colors.accent[50] }]}>
                  <Ionicons name="shield-outline" size={18} color={colors.accent[600]} />
                </View>
              }
              showChevron
              onPress={() => {}}
            />
            <ListItem
              title="Help & Support"
              leftIcon={
                <View style={[styles.settingsIcon, { backgroundColor: colors.success[50] }]}>
                  <Ionicons name="help-circle-outline" size={18} color={colors.success[600]} />
                </View>
              }
              showChevron
              onPress={() => {}}
            />
            <ListItem
              title="About App"
              subtitle="Version 1.0.0"
              leftIcon={
                <View style={[styles.settingsIcon, { backgroundColor: colors.gray[100] }]}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.gray[600]} />
                </View>
              }
              showChevron
              onPress={() => {}}
            />
          </Card>
        </View>

        <View style={styles.logoutSection}>
          <TouchableOpacity
            onPress={handleLogout}
            activeOpacity={0.7}
            style={styles.logoutButton}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.error} />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerGradient: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.white,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  profileCard: {
    backgroundColor: colors.white,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: borderRadius.lg,
    padding: 24,
    alignItems: 'center',
    ...shadow.md,
  },
  avatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 3,
    borderColor: colors.primary[200],
  },
  avatarLargeText: {
    ...typography.h2,
    color: colors.primary[600],
  },
  profileName: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  shopName: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  partnerIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.gray[50],
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  partnerId: {
    ...typography.captionMedium,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    ...typography.captionMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
  },
  fieldCard: {
    padding: 0,
    overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldContent: {
    flex: 1,
    gap: 2,
  },
  fieldLabel: {
    ...typography.small,
    color: colors.textMuted,
  },
  fieldValue: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
  },
  settingsIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutSection: {
    marginTop: 32,
    paddingHorizontal: 20,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderRadius: borderRadius.base,
    paddingVertical: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#FEE2E2',
    ...shadow.sm,
  },
  logoutText: {
    ...typography.button,
    color: colors.error,
  },
});
