// src/presences/presences.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PresencesService } from './presences.service';
import { PresencesController } from './presences.controller';
import { Presence } from './entities/presence.entity';
import { Booth } from '../booths/entities/booth.entity';
import { AuthModule } from '../auth/auth.module'; // Importa para herdar o JwtAuthGuard

@Module({
  imports: [
    TypeOrmModule.forFeature([Presence, Booth]),
    AuthModule, // <-- IMPORTANTE para que o JwtAuthGuard funcione
  ],
  controllers: [PresencesController],
  providers: [PresencesService],
})
export class PresencesModule {}