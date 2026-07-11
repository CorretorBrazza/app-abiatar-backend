// src/presences/presences.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PresencesService } from './presences.service';
import { PresencesController } from './presences.controller';
import { Presence } from './entities/presence.entity';
import { Booth } from '../booths/entities/booth.entity';
import { DeadManLog } from './entities/dead-man-log.entity'; // Importa a nova entidade de logs
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Presence, Booth, DeadManLog]), // <-- REGISTRADO DEADMANLOG AQUI
    AuthModule,
  ],
  controllers: [PresencesController],
  providers: [PresencesService],
})
export class PresencesModule {}