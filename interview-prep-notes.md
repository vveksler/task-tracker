# Interview Prep Notes — Modules 1 & 2

Подробные ответы на вопросы по NestJS Architecture & DI и Prisma & PostgreSQL,
основанные на реальном коде проекта task-tracker.

---

## Module 1 — NestJS Architecture & Dependency Injection

### 1.1 Модульная архитектура

NestJS организует приложение через **модули** — каждый модуль инкапсулирует
связанный набор функциональности: контроллеры, сервисы, guard'ы.

```
AppModule (корень)
├── ConfigModule          ← конфигурация (env variables)
├── PrismaModule          ← доступ к БД (@Global)
├── HealthModule          ← health checks
├── AuthModule            ← аутентификация (JWT, Passport)
├── WorkspacesModule      ← CRUD workspaces + members
├── ProjectsModule        ← CRUD projects
├── TasksModule           ← CRUD tasks + reorder
├── GatewayModule         ← WebSocket (Socket.io)
└── AnalyticsModule       ← dashboard data
```

Каждый модуль объявляет:
- **`providers`** — сервисы, которые модуль создаёт (DI контейнер инстанцирует)
- **`controllers`** — обработчики HTTP-запросов
- **`imports`** — другие модули, из которых нужны экспортированные провайдеры
- **`exports`** — провайдеры, доступные другим модулям, которые импортируют этот

Пример: `PrismaModule` использует `@Global()` — достаточно импортировать один раз
в `AppModule`, и `PrismaService` доступен во всех модулях без повторного
`imports: [PrismaModule]`.

---

### 1.2 Dependency Injection (DI)

**DI** — паттерн, при котором зависимости не создаются внутри класса, а
передаются ему извне. NestJS делает это автоматически через DI контейнер.

```typescript
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,  // NestJS сам создаёт и передаёт
  ) {}
}
```

Как это работает:
1. `@Injectable()` помечает класс как управляемый DI контейнером
2. NestJS анализирует параметры конструктора через TypeScript metadata
3. Для каждого параметра ищет в DI контейнере соответствующий провайдер
4. Создаёт экземпляр и передаёт зависимости

**Без `@Injectable()`** — NestJS не может корректно инжектить зависимости.
В проекте при удалении `@Injectable()` с `AuthService`, `this.prisma` приходил
как `undefined` — зависимости не были разрезолвлены.

---

### 1.3 Provider Scopes — Singleton vs Request-Scoped

| Scope | Создаётся | Когда использовать |
|---|---|---|
| **Singleton** (default) | Один экземпляр на всё приложение | 99% случаев: stateless сервисы |
| **Request** | Новый экземпляр на каждый HTTP-запрос | Когда нужны данные текущего запроса (tenant ID, user locale) |
| **Transient** | Новый экземпляр при каждой инжекции | Редко: каждый потребитель получает свой экземпляр |

В нашем проекте **всё singleton** — сервисы stateless, состояние хранится в БД.

**Request-scoped** нужен, когда сервису необходим доступ к данным текущего
запроса (например, текущий tenant в multi-tenant системе). Но есть цена:
- Каждый запрос создаёт новые экземпляры всех зависимостей в цепочке
- Request scope "заражает" — если A request-scoped, и B зависит от A, то B тоже
  становится request-scoped
- Больше аллокаций → хуже производительность

**Аналогия с фронтендом:** singleton — как глобальный стор (Zustand), один на всё
приложение. Request-scoped — как React Context, создаётся для каждого рендер-цикла.

---

### 1.4 Декораторы как метаданные (Reflector)

Декораторы в NestJS не содержат логики — они **прикрепляют метаданные** к классам
и методам. Guard'ы и interceptor'ы потом **читают** эти метаданные через `Reflector`.

Пример: `@Roles('ADMIN')` → `WorkspaceRolesGuard`

```typescript
// Декоратор — только устанавливает метаданные
@SetMetadata('roles', ['ADMIN'])
export const Roles = (...roles: WorkspaceRole[]) =>
  SetMetadata(ROLES_KEY, roles);

// Guard — читает метаданные и принимает решение
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<WorkspaceRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    // если @Roles('ADMIN') — проверить роль в workspace
    // если @Roles() не указан — любой member проходит
  }
}
```

`Reflector.getAllAndOverride()` — ищет метаданные сначала на **методе**, потом
на **классе**. Метод-уровень приоритетнее (override).

---

### 1.5 Request Lifecycle — порядок выполнения

```
Incoming Request
    │
    ▼
1. Middleware         ← express-совместимый, доступ к req/res/next
    │
    ▼
2. Guards             ← бинарный вопрос: пускать или нет?
    │                    - JwtAuthGuard: аутентификация (валидный ли токен?)
    │                    - WorkspaceRolesGuard: авторизация (есть ли доступ?)
    ▼
3. Interceptors       ← BEFORE handler (код до next.handle())
    │                    Пример: LoggingInterceptor логирует "→ GET /tasks"
    ▼
4. Pipes              ← валидация и трансформация данных
    │                    ValidationPipe: проверяет DTO через class-validator
    ▼
5. Route Handler      ← метод контроллера (бизнес-логика)
    │
    ▼
6. Interceptors       ← AFTER handler (код в tap() после next.handle())
    │                    Пример: LoggingInterceptor логирует "← GET /tasks — 5ms"
    ▼
7. Exception Filters  ← обработка ошибок (если что-то выбросило exception)
    │
    ▼
Response
```

**Ключевой момент:** если Guard отклонил запрос (шаг 2), Pipes, Handler и
Interceptors **не выполняются вообще**. Guard — первая линия обороны.

---

### 1.6 Guards — Аутентификация vs Авторизация

В проекте два guard'а, каждый отвечает на свой вопрос:

#### JwtAuthGuard — "Кто ты?" (Аутентификация)

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;  // @Public() пропускает без токена
    return super.canActivate(context);  // Passport проверяет JWT
  }
}
```

- Зарегистрирован **глобально** через `APP_GUARD` → применяется ко всем роутам
- Проверяет: валидный ли JWT токен? Если да — кладёт `user` в `request`
- `@Public()` — декоратор для роутов без авторизации (login, register)

#### WorkspaceRolesGuard — "Имеешь ли ты право?" (Авторизация)

```typescript
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Достаёт workspaceId из URL params
    // 2. Идёт в БД: является ли user членом этого workspace?
    // 3. Если @Roles('ADMIN') — проверяет роль
  }
}
```

- Применяется **на уровне контроллера** через `@UseGuards(WorkspaceRolesGuard)`
- Идёт в базу данных при каждом запросе (роль всегда актуальна)
- Не в JWT, а из БД — если админ забрал роль, это работает мгновенно

**Почему два отдельных guard'а, а не один?**
- **Разделение ответственности:** аутентификация ≠ авторизация
- **Разная область применения:** JWT — глобальный, Roles — только на workspace-роутах
- **Разная частота использования:** `/auth/login` нужен JwtAuthGuard (пропуск через
  `@Public()`), но не нужен WorkspaceRolesGuard
- **Тестируемость:** каждый guard тестируется изолированно

---

### 1.7 Guard vs Interceptor — почему auth это Guard?

| | Guard | Interceptor |
|---|---|---|
| **Когда выполняется** | До Pipes и Handler | Оборачивает Handler (до и после) |
| **Может отклонить запрос?** | Да (return false / throw) | Может, но семантически неправильно |
| **Если отклонит** | Pipes и Handler НЕ выполняются | Pipes уже выполнились зря |
| **Семантика** | "Пускать или нет?" | "Обернуть обработку" |

Если бы auth был interceptor — невалидный запрос прошёл бы через Pipes (парсинг
body, UUID валидация) только чтобы потом быть отклонённым. Это лишняя работа
и семантически неправильно.

**Interceptor "before"** выполняется после Guards, но до Pipes и Handler — это
другое "before", чем у Guard. Guard блокирует раньше.

---

### 1.8 Interceptors — паттерн "before/after"

Interceptor оборачивает route handler через RxJS Observable:

```typescript
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const now = Date.now();
    // BEFORE — код выполняется до handler
    this.logger.log(`→ ${method} ${url}`);

    return next.handle().pipe(
      // AFTER — код выполняется после handler вернул ответ
      tap(() => {
        const ms = Date.now() - now;
        this.logger.log(`← ${method} ${url} — ${ms}ms`);
      }),
    );
  }
}
```

Применение: `@UseInterceptors(LoggingInterceptor)` на контроллере или методе.

Типичные use cases:
- **Логирование** — замер времени обработки
- **Трансформация ответа** — обернуть данные в стандартную структуру
- **Кэширование** — вернуть кэш вместо вызова handler
- **Timeout** — прервать запрос если handler слишком долгий

---

### 1.9 Pipes — валидация и трансформация

```typescript
@Post()
async create(@Body() dto: CreateTaskDto) { ... }
```

`ValidationPipe` (глобальный) проверяет `dto` через декораторы `class-validator`:
- `@IsString()`, `@IsEnum(TaskStatus)`, `@IsUUID()` и т.д.
- Если валидация не прошла → 400 Bad Request (handler не вызывается)

`ParseUUIDPipe` — трансформирует строку в UUID и валидирует формат.

Pipes выполняются **после Guards** и **до Handler** — данные уже проверены,
когда handler их получает.

---

### 1.10 Exception Filters

Ловят exception из любой части lifecycle и формируют HTTP-ответ.

NestJS имеет встроенный фильтр:
- `BadRequestException` → 400
- `UnauthorizedException` → 401
- `ForbiddenException` → 403
- `NotFoundException` → 404
- `ConflictException` → 409

Можно создать кастомный `@Catch()` фильтр для специфичной обработки
(например, логирование в Sentry, кастомный формат ошибок).

---

### 1.11 @UseGuards на контроллере vs на методе

```typescript
// На контроллере — применяется ко ВСЕМ методам
@UseGuards(WorkspaceRolesGuard)
@Controller('workspaces/:workspaceId/tasks')
export class TasksController { ... }

// На методе — только к этому endpoint
@Roles('ADMIN')
@Delete(':id')
async remove(...) { ... }
```

`@Roles('ADMIN')` на методе + `WorkspaceRolesGuard` на контроллере:
guard видит `@Roles` через `Reflector.getAllAndOverride()` — метод приоритетнее
класса. Для DELETE нужен ADMIN, для остальных методов — любой member.

---

---

## Module 2 — Prisma & PostgreSQL

### 2.1 Что такое Prisma

**Prisma** — type-safe ORM для Node.js/TypeScript. Единственный source of truth
для структуры базы — файл `schema.prisma`. Из него генерируются:
- SQL миграции (для PostgreSQL)
- TypeScript типы клиента (полная автоподстановка в IDE)

Два пакета:
- `prisma` (devDependency) — CLI для миграций, generate, studio
- `@prisma/client` (dependency) — runtime библиотека для запросов

---

### 2.2 Подключение к базе данных

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

`DATABASE_URL` — единственная env variable, которую знает Prisma:

```
postgresql://tracker:tracker@localhost:5432/task_tracker?schema=public
│            │       │       │              │             │
protocol     user    pass    host:port      database      schema
```

---

### 2.3 Интеграция с NestJS

```typescript
// PrismaService — обёртка над PrismaClient
@Injectable()
export class PrismaService extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit()    { await this.$connect(); }    // подключиться при старте
  async onModuleDestroy() { await this.$disconnect(); } // отключиться при остановке
}

// PrismaModule — глобальный, доступен везде без повторного import
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Любой сервис просто инжектит `PrismaService`:

```typescript
constructor(private readonly prisma: PrismaService) {}
```

---

### 2.4 Migrations vs db push

| | `migrate dev` | `db push` |
|---|---|---|
| Создаёт SQL файл | Да (в `prisma/migrations/`) | Нет |
| Версионируется в git | Да | Нет |
| Production-safe | Да (`migrate deploy`) | Никогда |
| Для чего | Стабильная разработка, production | Быстрое прототипирование |

**`migrate dev`** — сравнивает `schema.prisma` с текущей базой, генерирует SQL
миграцию, применяет её, запускает `prisma generate`.

**`migrate deploy`** — применяет непримённые миграции без создания новых.
Используется в production (в Dockerfile, в Helm migrate-job).

**`db push`** — применяет schema.prisma напрямую к базе без файлов миграций.
Удобно на ранних этапах, когда схема меняется каждые 5 минут. Но никогда
для production — нет истории изменений, нет возможности откатить.

В проекте с первого дня — только `migrate dev`. 4 миграции:

```
prisma/migrations/
├── 20260714114618_init/                      ← начальная схема
├── 20260714140615_add_in_review_status/      ← новый enum IN_REVIEW
├── 20260714150814_add_created_at_index/      ← индекс для analytics
└── 20260715120000_add_grace_period/          ← поле replacedByHash
```

---

### 2.5 select vs include

```typescript
// select — забирает ТОЛЬКО указанные поля (whitelist)
const task = await prisma.task.findUnique({
  where: { id },
  select: {
    id: true,
    title: true,
    status: true,
    project: { select: { workspaceId: true } },  // вложенный select для связи
  },
});
// Результат: { id, title, status, project: { workspaceId } }

// include — забирает ВСЕ поля модели + указанные связи
const task = await prisma.task.findUnique({
  where: { id },
  include: { project: true },
});
// Результат: { id, title, description, status, order, ..., project: { id, name, ... } }
```

**`select`** — точный контроль над данными. Меньше данных → быстрее запрос,
меньше трафик. В проекте используется повсеместно через `TASK_SELECT` объект.

**`include`** — удобно, когда нужны все поля + связи. Может вытянуть лишнее.

---

### 2.6 N+1 Problem

**Проблема:** запрашиваем 10 проектов, для каждого нужны задачи. Без оптимизации:

```
SELECT * FROM projects WHERE workspaceId = '...'        -- 1 запрос
SELECT * FROM tasks WHERE projectId = 'proj-1'          -- +1
SELECT * FROM tasks WHERE projectId = 'proj-2'          -- +1
...                                                      -- +1
SELECT * FROM tasks WHERE projectId = 'proj-10'         -- +1
                                                          = 11 запросов!
```

**Решение в Prisma — `include` / `select` с вложениями:**

```typescript
const projects = await prisma.project.findMany({
  where: { workspaceId },
  include: { tasks: true },   // Prisma делает 2 запроса, не 11
});
```

Prisma генерирует:
1. `SELECT * FROM projects WHERE "workspaceId" = '...'`
2. `SELECT * FROM tasks WHERE "projectId" IN ('proj-1', 'proj-2', ..., 'proj-10')`

**2 запроса вместо 11** — Prisma автоматически использует `IN (...)` для связей.

---

### 2.7 Transactions — зачем и как

#### Batch transactions (неявные)

```typescript
const [user, workspace] = await prisma.$transaction([
  prisma.user.create({ data: { ... } }),
  prisma.workspace.create({ data: { ... } }),
]);
```

Всё или ничего — если второй create упадёт, первый откатится.

#### Interactive transactions (с callback)

```typescript
const result = await prisma.$transaction(async (tx) => {
  const task = await tx.task.findUnique({ where: { id } });
  // ... логика на основе прочитанных данных ...
  return tx.task.update({ where: { id }, data: { ... } });
});
```

Позволяют читать → принять решение → записать — всё внутри одной транзакции.

---

### 2.8 Isolation Levels — Read Committed vs Serializable

#### Read Committed (default PostgreSQL)

Каждый `SELECT` видит **только закоммиченные** данные. Но между двумя SELECT'ами
в одной транзакции другая транзакция может вставить/обновить строки.

```
Transaction A:  SELECT order FROM tasks WHERE status='TODO'  → [1, 2, 3]
Transaction B:  SELECT order FROM tasks WHERE status='TODO'  → [1, 2, 3]  (тот же)
Transaction A:  UPDATE tasks SET order = 2.5                 → OK
Transaction B:  UPDATE tasks SET order = 2.5                 → OK (КОНФЛИКТ! Одинаковый order)
```

#### Serializable

Гарантирует, что транзакции выполняются **как будто последовательно**.
Если B читает данные, которые A изменила — B получит ошибку сериализации (P2034)
и должна повторить.

```
Transaction A:  SELECT order → [1, 2, 3]
Transaction B:  SELECT order → [1, 2, 3]
Transaction A:  UPDATE SET order = 2.5 → OK, COMMIT
Transaction B:  UPDATE SET order = 2.5 → ERROR: serialization failure!
Transaction B:  RETRY → SELECT order → [1, 2, 2.5, 3] → вычисляет новый midpoint
```

#### В проекте

```typescript
// tasks.service.ts → reorderInTransaction
const moved = await this.prisma.$transaction(
  async (tx) => {
    // ... read orders, compute midpoint, update ...
  },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
);
```

**Serializable** используется в двух местах — оба связаны с полем `order`:

1. **`reorder`** — два конкурентных D&D запроса читают одни и те же order-значения
   и могут вычислить одинаковый midpoint
2. **`create`** — два конкурентных создания читают одинаковый `max(order)` и оба
   вставляют задачу с одним и тем же order

Общая причина: **read → compute → write** паттерн, где результат записи зависит
от прочитанных данных. Без Serializable два запроса прочитают одинаковое значение
и запишут одинаковый order.

**Trade-off:** Serializable дороже Read Committed — больше шансов на retry, чуть
больше блокировок. Но для этих двух операций это оправдано:
- Операции редкие (создание задачи, D&D — не каждую секунду)
- Последствия без Serializable — дубликаты order, сломанный порядок задач
- Retry логика уже встроена (MAX_RETRIES = 2 в reorder)

**Почему не Serializable везде?** Большинство операций (create task, update task,
read tasks) не конфликтуют друг с другом — Read Committed достаточен.
Serializable "everywhere" = лишние serialization failures и retries без причины.

---

### 2.9 Indexes — B-tree и композитные индексы

#### Что такое индекс

Дополнительная структура данных (B-tree) на диске, отсортированная по значениям
колонки. Позволяет PostgreSQL находить нужные строки за O(log n) вместо
полного перебора таблицы O(n).

**Аналогия:** указатель в конце книги. Не нужно листать все 500 страниц —
открываешь указатель, находишь термин, идёшь на нужную страницу.

#### B-tree структура

```
                    [projectId=ddd]
                   /               \
     [projectId=bbb]               [projectId=fff]
    /               \
[aaa: Jul01,Jul02]  [ccc: Jul05]
```

Поиск: `WHERE projectId = 'bbb'` → от корня за 2 перехода вместо перебора всех строк.

#### Композитный индекс и порядок колонок

Индекс `(projectId, createdAt)` — отсортирован сначала по projectId, внутри
каждого projectId — по createdAt:

```
projectId=aaa
  createdAt=2026-07-01
  createdAt=2026-07-02
  createdAt=2026-07-03
projectId=bbb
  createdAt=2026-07-01
  createdAt=2026-07-05
```

**Leftmost prefix rule:** индекс `(A, B)` эффективен для:
- Запросов по `A` — да (используется первый уровень дерева)
- Запросов по `A + B` — да (оба уровня)
- Запросов **только по `B`** — нет! (нужно перебрать все значения A)

Если бы нам часто нужен был запрос только по `createdAt` без `projectId` —
потребовался бы отдельный индекс на `createdAt`.

#### Индексы в проекте

```prisma
model Task {
  @@index([projectId, status])       // фильтрация задач по проекту и статусу (Kanban board)
  @@index([assigneeId])              // поиск задач по assignee
  @@index([projectId, createdAt])    // analytics: activity по дням в проекте
}
```

#### Когда индекс НЕ стоит добавлять

- **Маленькая таблица** (< 1000 строк) — Seq Scan быстрее обхода B-tree
- **Write-heavy таблица** — каждый INSERT/UPDATE обновляет индекс, дополнительная нагрузка
- **Низкая selectivity** — колонка boolean с 50/50 распределением, индекс не поможет

---

### 2.10 EXPLAIN ANALYZE — чтение плана запроса

#### EXPLAIN vs EXPLAIN ANALYZE

| | EXPLAIN | EXPLAIN ANALYZE |
|---|---|---|
| Выполняет запрос? | Нет (только план) | **Да** (реальное выполнение) |
| Показывает | Оценочный plan + estimated cost | Реальный plan + **actual time** |
| Когда | Быстро глянуть план | Когда нужны точные цифры |

`EXPLAIN` — PostgreSQL "предсказывает" что сделает. Может ошибаться.
`EXPLAIN ANALYZE` — выполняет и показывает, что реально произошло.

#### Типы сканирования

| Тип | Что делает | Когда |
|---|---|---|
| **Seq Scan** | Читает ВСЕ строки таблицы | Нет подходящего индекса или таблица маленькая |
| **Index Scan** | Идёт по индексу, потом в таблицу за полными данными | Есть индекс, нужны поля не из индекса |
| **Index Only Scan** | Читает ТОЛЬКО из индекса | Все нужные колонки есть в индексе |
| **Bitmap Index/Heap Scan** | Индекс → bitmap → batch read из таблицы | Много строк подходит под условие |

#### Реальный эксперимент из проекта

**С индексом `(projectId, createdAt)`:**

```
Index Only Scan using "tasks_projectId_createdAt_idx"
  Index Cond: ("projectId" = p.id) AND ("createdAt" >= ...)
  actual rows=233, loops=8
  Heap Fetches: 9
Planning Time: 0.861 ms
Execution Time: 1.104 ms
```

- **Index Only Scan** — PostgreSQL нашёл всё в B-tree, в таблицу сходил 9 раз
- Прочитал только 1864 строки (233 × 8 проектов)

**Без индекса:**

```
Seq Scan on tasks t
  Filter: ("createdAt" >= ...)
  Rows Removed by Filter: 3638
Planning Time: 0.630 ms
Execution Time: 5.163 ms
```

- **Seq Scan** — прочитал ВСЕ 5504 строки, выбросил 3638 как ненужные
- В 5 раз медленнее. На 500,000 задач разница была бы ~500x

#### Как читать план

Читается **снизу вверх** — от самых вложенных операций к верхним:

```
GroupAggregate                          ← 5. группировка по дням
  Sort                                 ← 4. сортировка по date_trunc
    Nested Loop                        ← 3. для каждого проекта → найти задачи
      Bitmap Heap Scan on projects     ← 1. найти проекты workspace
        Bitmap Index Scan              ← (индекс projects_workspaceId_idx)
      Index Only Scan on tasks         ← 2. найти задачи по projectId + createdAt
```

Ключевые поля:
- `actual time=X..Y` — время в ms (X = до первой строки, Y = все строки)
- `rows=N` — сколько строк вернул шаг
- `loops=N` — сколько раз шаг выполнился (Nested Loop → для каждого проекта)
- `Rows Removed by Filter` — сколько строк прочитано зря

---

### 2.11 Fractional Indexing для D&D

Задачи на Kanban-доске имеют порядок внутри колонки (TODO, IN_PROGRESS, и т.д.).
При drag-and-drop нужно изменить порядок без переиндексации всех задач.

**Подход:** поле `order: Float`. При перемещении задачи между двумя другими —
вычисляем midpoint:

```
Task A: order = 1.0
Task B: order = 2.0
Вставить между → order = 1.5

Вставить между A(1.0) и новой(1.5) → order = 1.25
```

**Проблема:** после множества перемещений дробные числа теряют точность
(Float64 имеет ~15-17 значащих цифр). Когда midpoint коллапсирует — нужен
**rebalance** всей колонки:

```typescript
// Если midpoint === afterOrder или beforeOrder — precision exhausted
if (midpoint === afterOrder || midpoint === beforeOrder) {
  await this.rebalanceColumn(tx, projectId, dto.status);
  return this.computeOrder(tx, projectId, dto);
}
```

`rebalanceColumn` — перенумеровывает все задачи в колонке как 1, 2, 3, ... и
после этого `computeOrder` вычисляет свежий midpoint.

---

### 2.12 Dev-инструменты Prisma

```bash
npx prisma studio           # GUI для просмотра/редактирования данных (localhost:5555)
npx prisma migrate dev       # создать и применить миграцию
npx prisma migrate deploy    # применить без создания (production)
npx prisma migrate reset     # DROP + CREATE + все миграции + seed
npx prisma migrate status    # какие миграции применены
npx prisma generate          # перегенерировать типизированный клиент
npx prisma db seed           # запустить seed.ts
npx prisma db pull           # introspection — сгенерировать schema из существующей БД
```

---

### 2.13 Работа с PostgreSQL напрямую

```bash
# Подключение к psql в Docker контейнере
docker exec -it task-tracker-postgres-1 psql -U tracker -d task_tracker

# Полезные psql мета-команды
\dt                    # список таблиц
\d tasks               # структура таблицы + индексы
\di                    # список индексов
\dT+                   # список enum типов
\q                     # выйти
```

---

---

## Дополнительно — Docker, K8s, Helm (из обсуждений)

### Docker

Инструмент для упаковки приложения вместе со всем окружением (OS, runtime,
зависимости) в изолированный образ (image), который одинаково запускается
на любой машине.

```
Dockerfile → docker build → Image → docker run → Container
(рецепт)     (сборка)       (файл)   (запуск)     (процесс)
```

- **Image** — неизменяемый snapshot (класс)
- **Container** — запущенный экземпляр image (инстанс)

### Docker Compose

Инструмент для запуска нескольких связанных контейнеров на одной машине
через один YAML файл. Для локальной разработки и тестирования.

### Kubernetes (K8s)

Платформа для оркестрации контейнеров в кластере: автоматический запуск,
масштабирование, восстановление после сбоев, балансировка трафика.

Ключевые ресурсы в проекте:
- **Deployment** — stateless поды (backend, frontend), легко масштабируются
- **StatefulSet** — для PostgreSQL (стабильное имя, постоянный volume)
- **Service** — внутренний DNS + балансировка (backend → 3 реплики)
- **HPA** — автоскейлинг по CPU (70% → добавить под)
- **Ingress** — единая точка входа, path-based routing
- **Job** — одноразовые задачи (миграции)
- **Secret / ConfigMap** — конфигурация и секреты

### Helm

Package manager для Kubernetes — шаблонизирует, версионирует и деплоит
набор K8s-манифестов как единый пакет (chart) одной командой.

```bash
helm install task-tracker ./helm/task-tracker          # деплой
helm upgrade task-tracker ./helm/task-tracker           # обновление
helm rollback task-tracker 1                            # откат
```

`values.yaml` — единственный файл для настройки окружения.

### Nginx / Ingress

Reverse proxy и load balancer. В K8s — Ingress Controller (nginx), который
K8s автоматически конфигурирует на основе Ingress-ресурсов. В проекте:

```
browser → task-tracker.local:80
  /api/auth/*   → frontend:3000  (BFF)
  /api/*        → backend:3001   (API, с rewrite /api → /)
  /socket.io    → backend:3001   (WebSocket)
  /*            → frontend:3000  (страницы)
```

### Три уровня деплоя

| Сценарий | Что в Docker | Маршрутизация |
|---|---|---|
| **Dev** (`npm run start:dev`) | Только PostgreSQL | Разные порты (3000, 3001) |
| **Docker Compose** | Всё | Разные порты (3000, 3001) |
| **Kubernetes** | Всё в кластере | Один домен, Ingress routing |

Разница между окружениями скрыта за env variables (`NEXT_PUBLIC_API_URL`,
`BACKEND_INTERNAL_URL`). Код приложения — один и тот же.
