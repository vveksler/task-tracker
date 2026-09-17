import {
  Body,
  Controller,
  INestApplication,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { KeyedThrottlerGuard } from './keyed-throttler.guard';

@Controller()
class DummyController {
  @Post('login')
  @UseGuards(KeyedThrottlerGuard)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  login(@Body() _body: unknown) {
    return { ok: true };
  }

  @Post('ask')
  @UseGuards(KeyedThrottlerGuard)
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  ask(@Req() _req: unknown) {
    return { ok: true };
  }
}

describe('KeyedThrottlerGuard', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
      ],
      controllers: [DummyController],
    }).compile();
    app = moduleRef.createNestApplication();
    // Simulate the global JwtAuthGuard populating req.user.
    app.use(
      (
        req: { user?: unknown; headers: Record<string, string> },
        _res: unknown,
        next: () => void,
      ) => {
        const sub = req.headers['x-test-user'];
        if (sub) req.user = { sub, email: `${sub}@test.dev` };
        next();
      },
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('limits per email, case-insensitively, independent of other emails', async () => {
    const server = app.getHttpServer();
    await request(server).post('/login').send({ email: 'a@x.dev' }).expect(201);
    await request(server)
      .post('/login')
      .send({ email: 'A@X.dev ' })
      .expect(201);
    await request(server).post('/login').send({ email: 'a@x.dev' }).expect(429);

    // Same source IP, different account — not affected (BFF shares one IP).
    await request(server).post('/login').send({ email: 'b@x.dev' }).expect(201);
  });

  it('limits authenticated routes per user id', async () => {
    const server = app.getHttpServer();
    await request(server).post('/ask').set('x-test-user', 'u1').expect(201);
    await request(server).post('/ask').set('x-test-user', 'u1').expect(429);
    await request(server).post('/ask').set('x-test-user', 'u2').expect(201);
  });
});
