import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from './api';

// Foreground behavior: show banner + play sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Optional backend endpoint to persist the push token. Left empty until the
// backend adds one; when set, the token is POSTed there after login.
const PUSH_TOKEN_ENDPOINT = '';

export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Transactions & Alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#2563EB',
  });
}

/**
 * Requests permission, gets the Expo push token, and (optionally) registers it
 * with the backend. Safe to call on every login; failures are swallowed so they
 * never block the app.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    await ensureAndroidChannel();
    if (!Device.isDevice) return null;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ||
      (Constants as any)?.easConfig?.projectId;
    if (!projectId) return null; // Expo push token needs an EAS projectId.

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    if (PUSH_TOKEN_ENDPOINT && token) {
      await api
        .post(PUSH_TOKEN_ENDPOINT, { token, platform: Platform.OS }, { silent401: true })
        .catch(() => null);
    }
    return token;
  } catch {
    return null;
  }
}

export function addNotificationResponseListener(cb: (data: any) => void) {
  return Notifications.addNotificationResponseReceivedListener((res) => {
    cb(res.notification.request.content.data);
  });
}
