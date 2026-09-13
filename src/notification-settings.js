export const DEFAULT_NOTIFICATION_SETTINGS = { sound: 'original', volume: 70, repeat: 1 };
const sounds = new Set(['original', 'none', 'notification-1', 'notification-3', 'notification-5', 'alert-1', 'alert-3', 'alert-5', 'meme-faaah', 'meme-aura', 'meme-pix', 'meme-magnata', 'meme-bruh']);

export function validateNotificationSettings(data) {
  if (!data || !sounds.has(data.sound) || !Number.isInteger(data.volume) || data.volume < 0 || data.volume > 100 || ![1, 2, 3].includes(data.repeat)) {
    throw new Error('Escolha um som válido, volume de 0 a 100 e de 1 a 3 toques.');
  }
  return { sound: data.sound, volume: data.volume, repeat: data.repeat };
}
