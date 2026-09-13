// src/notifications/utils/device-type.util.ts
export function classifyDeviceType(userAgent?: string | null): 'mobile' | 'web' {
  if (!userAgent) return 'web';
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent) ? 'mobile' : 'web';
}