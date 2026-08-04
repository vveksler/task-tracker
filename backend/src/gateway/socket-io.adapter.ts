import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.io CORS cannot read ConfigService from @WebSocketGateway() — decorator
 * options are evaluated at import time, before DI exists.
 *
 * Trade-off vs `origin: true` (reflect request Origin): that works in local
 * multi-origin setups but is too open for production with cookie credentials.
 * We mirror REST CORS in main.ts: exact FRONTEND_ORIGIN from ConfigService
 * (Railway: https://<frontend>.up.railway.app).
 */
export class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly frontendOrigin: string,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.frontendOrigin,
        credentials: true,
      },
    });
  }
}
