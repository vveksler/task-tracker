import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TaskGateway } from './task.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [TaskGateway],
  exports: [TaskGateway],
})
export class GatewayModule {}
