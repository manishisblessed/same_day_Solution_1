import * as SecureStore from 'expo-secure-store';

/**
 * Thin wrapper over expo-secure-store. SecureStore values are capped at ~2KB on
 * some platforms; Supabase sessions can exceed that, so large values are chunked.
 */
const CHUNK_SIZE = 1800;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const meta = await SecureStore.getItemAsync(key);
    if (meta === null) return null;
    if (!meta.startsWith('__chunks__:')) return meta;
    const count = parseInt(meta.split(':')[1], 10);
    let out = '';
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`);
      if (part === null) return null;
      out += part;
    }
    return out;
  },

  async setItem(key: string, value: string): Promise<void> {
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const count = Math.ceil(value.length / CHUNK_SIZE);
    await SecureStore.setItemAsync(key, `__chunks__:${count}`);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
  },

  async removeItem(key: string): Promise<void> {
    const meta = await SecureStore.getItemAsync(key);
    if (meta?.startsWith('__chunks__:')) {
      const count = parseInt(meta.split(':')[1], 10);
      for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${key}__${i}`);
    }
    await SecureStore.deleteItemAsync(key);
  },
};
