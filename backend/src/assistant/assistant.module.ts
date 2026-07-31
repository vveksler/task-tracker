import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { EmbeddingListenerService } from './embedding-listener.service';

@Module({
  controllers: [AssistantController],
  providers: [AssistantService, EmbeddingListenerService],
  exports: [AssistantService],
})
export class AssistantModule {}
