import { Global, Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeController } from './realtime.controller';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
