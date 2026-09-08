// src/utils/timezone.util.ts

export interface TimezoneNow {
  nowMinutes: number;
  nowFormatted: string;
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  dateStr: string; // YYYY-MM-DD
  isWeekend: boolean;
  hours: number;
  minutes: number;
}

export function getNowInTimezone(timeZone = 'America/Sao_Paulo'): TimezoneNow {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const hours = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const minutes = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  const seconds = Number(parts.find((p) => p.type === 'second')?.value || '0');

  const nowMinutes = hours * 60 + minutes + seconds / 60;
  const nowFormatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const day = parts.find((p) => p.type === 'day')?.value || '01';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  const dateStr = `${year}-${month}-${day}`;

  const localDt = new Date(new Date().toLocaleString('en-US', { timeZone }));
  const dayOfWeek = localDt.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return {
    nowMinutes,
    nowFormatted,
    dayOfWeek,
    dateStr,
    isWeekend,
    hours,
    minutes,
  };
}

export function timeStringToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim();
  const [h, m] = clean.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTimeString(totalMinutes: number): string {
  const normalized = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Constrói um Date UTC correspondente a um horário de parede (HH:mm) em uma data
 * específica, no fuso informado. Assume offset fixo -03:00 para America/Sao_Paulo
 * (Brasil não observa horário de verão desde 2019).
 */
export function getDateAtTimeInTimezone(dateStr: string, hhmm: string, timeZone = 'America/Sao_Paulo'): Date {
  const offset = timeZone === 'America/Sao_Paulo' ? '-03:00' : '+00:00';
  return new Date(`${dateStr}T${hhmm}:00${offset}`);
}
