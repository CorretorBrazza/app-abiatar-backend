// src/presences/dto/ping-response.dto.ts
export class PingResponseDto {
  pingLogId: string; // ID do ping pendente enviado pelo servidor que ele está respondendo
  latitude: number; // Coordenada capturada pelo GPS no ato do clique
  longitude: number; // Coordenada capturada pelo GPS no ato do clique
  ssid?: string; // SSID do Wi-Fi capturado (opcional) [7]
}