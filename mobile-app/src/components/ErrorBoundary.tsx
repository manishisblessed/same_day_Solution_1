import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Button } from './ui';

interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error);
  }

  reset = () => this.setState({ hasError: false, error: undefined });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.container}>
        <Ionicons name="bug-outline" size={48} color={colors.danger[500]} />
        <Text style={[typography.h2, { color: colors.textPrimary, marginTop: spacing.base }]}>Unexpected error</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center', marginTop: 6 }]}>
          The app hit a problem. You can try again.
        </Text>
        {__DEV__ && this.state.error ? (
          <ScrollView style={styles.debug}>
            <Text style={styles.debugText}>{this.state.error.message}</Text>
          </ScrollView>
        ) : null}
        <Button title="Try Again" icon="refresh" onPress={this.reset} style={{ marginTop: spacing.lg }} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background },
  debug: { maxHeight: 160, alignSelf: 'stretch', marginTop: spacing.base, backgroundColor: colors.gray[100], borderRadius: 10, padding: spacing.md },
  debugText: { ...typography.small, color: colors.danger[600] },
});
