// src/booths/dto/create-booth.dto.ts
export class CreateBoothDto {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  gps_radius?: number; // Opcional, assume o padrão se não enviado
  min_brokers_required?: number; // <-- ADICIONE ESTA LINHA [6]
  managerId?: string; // <-- ADICIONE ESTA LINHA [7]
  wifis?: string[]; // Array opcional de SSIDs de Wi-Fi (ex: ["Wifi_Plantao_1", "Wifi_Plantao_Backup"])
}