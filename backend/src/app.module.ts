import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  appConfig,
  jwtConfig,
  googleConfig,
  mailConfig,
  redisConfig,
  assistantConfig,
} from './config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { GatewayModule } from './gateway/gateway.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AssistantModule } from './assistant/assistant.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        jwtConfig,
        googleConfig,
        mailConfig,
        redisConfig,
        assistantConfig,
      ],
    }),
    EventEmitterModule.forRoot(),
    // Defaults only; limits are set per route with @Throttle and enforced by
    // KeyedThrottlerGuard where applied (no global guard).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    PrismaModule,
    MailModule,
    HealthModule,
    AuthModule,
    WorkspacesModule,
    ProjectsModule,
    TasksModule,
    GatewayModule,
    AnalyticsModule,
    AssistantModule,
  ],
})
export class AppModule {}
