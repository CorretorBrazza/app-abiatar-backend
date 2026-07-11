// src/presences/dto/check-in.dto.ts
export class CheckInDto {
  boothId: string; // ID do plantão onde o corretor tenta fazer check-in
  latitude: number; // Capturado pelo GPS do celular
  longitude: number; // Capturado pelo GPS do celular
  ssid?: string; // Opcional, enviado se o celular estiver conectado a um Wi-Fi [7]
}