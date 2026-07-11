// src/booths/dto/create-booth.dto.ts
export class CreateBoothDto {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  gps_radius?: number; // Opcional, assume o padrão se não enviado
  wifis?: string[]; // Array opcional de SSIDs de Wi-Fi (ex: ["Wifi_Plantao_1", "Wifi_Plantao_Backup"])
}