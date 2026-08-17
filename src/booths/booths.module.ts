// src/booths/booths.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoothsService } from './booths.service';
import { BoothsController } from './booths.controller';
import { Booth } from './entities/booth.entity';
import { BoothWifi } from './entities/booth-wifi.entity';
import { BoothReceptionist } from './entities/booth-receptionist.entity';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module'; // Importa o módulo de autenticação para herdar o JWT

@Module({
  imports: [
    TypeOrmModule.forFeature([Booth, BoothWifi, BoothReceptionist, User]),
    AuthModule, // <-- ESSENCIAL para que o JwtAuthGuard funcione neste controlador
  ],
  controllers: [BoothsController],
  providers: [BoothsService],
})
export class BoothsModule {}