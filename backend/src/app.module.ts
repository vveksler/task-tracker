import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { appConfig, jwtConfig } from './config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { GatewayModule } from './gateway/gateway.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, jwtConfig],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    WorkspacesModule,
    ProjectsModule,
    TasksModule,
    GatewayModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
