# Fractal Narrative Engine — Composite Artifacts RFC

> **Статус:** RFC / Implementation-ready proposal · **Язык:** RU · **Адресат:** разработчик / Claude Code  
> **Контекст:** дополнение к `ARCHITECTURE.md` существующего Fractal Narrative Engine. **Не заменяет** текущую модель артефактов, связей, рекурсивных мостов и ACL.  
> **Цель:** реализовать обратимую композицию готовых фрагментов графа в самостоятельные составные артефакты. Любой составной артефакт должен участвовать в обычной операции `Bridge(A, B)`, а полученный результат — снова компоноваться.

## 1. Ключевая идея

Система работает **в обоих направлениях и на любом масштабе**:

1. **Expand / Bridge:** из двух артефактов `A` и `B` получить объясняющий `C` и рекурсивно развернуть связи `A→C` и `C→B` в отдельные арки.
2. **Compose:** взять уже построенный связанный фрагмент (подграф) из нескольких артефактов и создать над ним **новый составной артефакт `M`**. Его внутренний граф не удаляется: `M` лишь предоставляет компактное представление, границы, инварианты и provenance.
3. **Reuse:** взять два таких составных артефакта `M` и `N` как новые `A` и `B`; применить к ним тот же `Bridge(M, N) → C`; детализировать переход и при желании свернуть его в `P`.
4. **Repeat:** повторять на уровнях факт → сцена → арка → акт → история → вселенная. Уровни **не хардкодятся**: это метки/представления, а не разные сущности хранения.

```text
[ a1 — c1 — a2 — c2 — a3 ]      [ b1 — c3 — b2 ]
            |                               |
         Compose                         Compose
            v                               v
         [ M / A ]  ---- Bridge ---->     [ N / B ]
                         |
                         v
                       [ C ]
                         |
              Expand(M,C) / Expand(C,N)
                         |
                         v
            [ connected larger graph ]
                         |
                      Compose
                         v
                       [ P ]
```

**Главный тезис:** связь между двумя произвольными узлами (в том числе _составными_) — самостоятельный объект генерации. Ее можно развернуть в подграф, а любой полученный подграф — представить одним новым узлом. Это **композиционная фрактальная модель**, а не просто UI-группировка.

## 2. Разграничить три операции

| Операция             | Что делает                                                                                      | Изменяет семантику?                          | Удаляет оригиналы? |
| -------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------ |
| `Collapse(view)`     | Визуально скрывает внутренние узлы за карточкой                                                 | Нет                                          | Нет                |
| `Compose(selection)` | Создаёт **версионируемый составной артефакт** поверх подграфа с интерфейсом и политикой доступа | Да: новая сущность и новая абстракция        | Нет                |
| `Expand(relation)`   | Строит промежуточный артефакт/арку между двумя существующими артефактами                        | Да: новые факты/отношения/история объяснения | Нет                |

**Важно:** `Expand` — термин с двумя распространёнными значениями. В API использовать разные имена: `expandRelation` для генерации мостов и `openComposite` для UI-раскрытия составного артефакта. Не смешивать их.

### 2.1 Инварианты

- **Никакого деструктивного merge:** исходные node IDs, relations, revisions, bridge history и ownership неизменны после Compose.
- **Единая модель:** атомарный и составной артефакты могут быть `from/to` любой связи и `A/B` любого запуска.
- **Граница композиции явная:** составной артефакт объявляет публичные `entry`, `exit`, `assertions`, `constraints`, `openQuestions`, `summary`, но не «проглатывает» все внутренние данные.
- **Нет неявного раскрытия приватного:** видимость составного узла не даёт автоматически READ всем его потомкам.
- **Контракт на версии:** мост ссылается на **конкретную версию интерфейса** входных артефактов; изменение интерфейса помечает потенциально устаревшие мосты.
- **Никаких циклов владения:** нельзя включить артефакт в самого себя транзитивно.
- **Семантические связи ≠ связи вхождения:** `causes`, `precedes`, `bridges`, `enables` не смешиваются с `contains`/`member_of`.
- **Подграф может иметь внешние связи:** их нельзя потерять или переподключить автоматически с изменением смысла.

## 3. Модель данных

Не создавайте отдельную несовместимую иерархию `Fact`/`Scene`/`Arc` с разными API. Используйте существующий `Artifact`, добавив возможность композиции.

```ts
// Упрощённые контракты, не обязательная миграция 1:1

type ArtifactId = string;
type RevisionId = string;
type RelationId = string;
type CompositeId = ArtifactId;

type ArtifactKind = 'atomic' | 'composite';

type Artifact = {
	id: ArtifactId;
	projectId: string;
	kind: ArtifactKind;
	title: string;
	summary: string;
	currentRevisionId: RevisionId;
	visibilityScope: 'A' | 'B' | 'C' | 'public'; // совместить с текущим ACL
	ownerPrincipalId: string;
	status: 'draft' | 'accepted' | 'rejected' | 'archived';
	metadata?: Record<string, unknown>;
};

type CompositeDefinition = {
	artifactId: CompositeId;
	revisionId: RevisionId;
	memberArtifactIds: ArtifactId[]; // прямые члены, допускаются другие composites
	memberRelationIds: RelationId[]; // точный снимок включённых семантических рёбер
	boundary: {
		entries: ArtifactId[];
		exits: ArtifactId[];
		externallyRelevantRelations: RelationId[];
	};
	contract: CompositeInterface;
};

type ClaimRef = {
	claimId: string;
	sourceArtifactId: ArtifactId;
	sourceRevisionId: RevisionId;
};

type CompositeInterface = {
	summary: string;
	entryConditions: ClaimRef[];
	exitConditions: ClaimRef[];
	invariants: ClaimRef[];
	keyClaims: ClaimRef[];
	openQuestions: string[];
	// Можно добавить narratological descriptors: tone, participants, timeRange
};

type BridgeInput = {
	left: { artifactId: ArtifactId; revisionId: RevisionId };
	right: { artifactId: ArtifactId; revisionId: RevisionId };
	// Gateway отдаёт только разрешённые агенту представления
};
```

### 3.1 Стабильная идентичность и редакции

- `Artifact.id` остаётся постоянным; контент меняется через append-only `ArtifactRevision`.
- `CompositeDefinition` привязан к конкретной ревизии составного артефакта и определённому набору **версий** участников/рёбер (в реальной схеме добавить `memberRevisionId`, `relationRevisionId`).
- Публичный summary/contract — **проекция**, а не замена внутренней структуры.
- Составные артефакты могут включать другие составные; для проверки циклов использовать рекурсивный обход membership, а не ограничивать глубину одним уровнем.
- Один исходный артефакт может повторно использоваться в нескольких композициях (_DAG membership_), если это допустимо продуктом. Это **не копия** с новой идентичностью. Опционально позднее поддержать `fork/clone` как отдельную операцию.

### 3.2 Что происходит с рёбрами на границе

Пример: `X → a2`, где `a2 ∈ M`, а `X ∉ M`.

- Исходное ребро `X → a2` **сохраняется без изменений**.
- В закрытом виде UI может показывать **производное (виртуальное)** ребро `X → M` с меткой `aggregated`, указывая список оригинальных relation IDs. Не записывать его как настоящее `causes`/`precedes` без согласованного семантического решения.
- Когда кто-то пишет `Bridge(X,M)`, это **новая реальная связь с M как сущностью**, а не автоматическая перезапись старой `X → a2`.
- При повторном раскрытии пользователь видит обе категории отношений (внутренние исходные и внешние/агрегированные) и может перейти к источникам.

### 3.3 Противоречия

`Compose` **не исправляет** противоречия и не принуждает к глобальному согласованию. Он сохраняет исходные утверждения и фиксирует интерпретацию в contract. Верификатор может отмечать tensions, unresolved claims и несовместимые версии. Они служат входом для будущих Bridge-итераций.

## 4. Предлагаемая SQL-модель / минимальная миграция

Адаптировать к текущей Prisma/Drizzle/SQL-модели; **не переписывать существующую БД**.

```sql
-- artifacts: добавить kind ('atomic'|'composite'), если отсутствует
-- composite_definition_revision: ревизия композиции + контракт
CREATE TABLE composite_definition_revision (
  id UUID PRIMARY KEY,
  composite_artifact_id UUID NOT NULL REFERENCES artifact(id),
  artifact_revision_id UUID NOT NULL REFERENCES artifact_revision(id),
  contract_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE composite_member (
  definition_revision_id UUID NOT NULL REFERENCES composite_definition_revision(id),
  member_artifact_id UUID NOT NULL REFERENCES artifact(id),
  member_revision_id UUID NOT NULL REFERENCES artifact_revision(id),
  display_order INT NOT NULL,
  PRIMARY KEY (definition_revision_id, member_artifact_id)
);

CREATE TABLE composite_relation_member (
  definition_revision_id UUID NOT NULL REFERENCES composite_definition_revision(id),
  relation_id UUID NOT NULL REFERENCES relation(id),
  -- relation_revision_id UUID ... (если связи версионируются)
  PRIMARY KEY (definition_revision_id, relation_id)
);
```

Реальные имена таблиц/типов привести к проекту; обеспечить `project_id` consistency и RLS/ACL через серверный слой. Метаданные `boundary` хранить в `contract_json` или отдельной таблице. `composite_member` намеренно не ограничен уникальностью `member_artifact_id` глобально.

В MVP можно начать с одной `composite_definition` с JSON `members`/`relationIds`, **если** ревизии, индексы и транзакционная валидация обеспечены. Нормализованные таблицы удобнее при росте.

## 5. Алгоритмы

### 5.1 Compose(selection, options)

**Вход:** набор узлов и отношений, заголовок/summary, опциональные entry/exit, policy видимости. **Результат:** новый `Artifact(kind='composite')` и зафиксированная ревизия композиции.

1. Проверить авторизацию на чтение **каждого** узла/отношения и право создавать композицию в проекте.
2. Проверить, что элементы относятся к одному проекту; нет циклов membership; допустим тип фрагмента (связность можно рекомендовать, но не всегда требовать — например для параллельных арок).
3. Зафиксировать ревизии участников и отношений в snapshot.
4. Найти кандидатов на входы/выходы по пересечениям границы; пользователь может переопределить, сохранив проверку.
5. Создать/отредактировать `CompositeInterface`: краткое описание, граничные состояния, ключевые факты, инварианты, нерешённые вопросы; **без автоматической публикации приватных сведений**.
6. Одной транзакцией создать artifact, revision, composition definition, member links, audit event.
7. Возвратить composite ID + revision ID; старый граф не трогать.

**Сложные случаи:** частичный выбор, повторное использование узлов, внешние связи, вложенные composite, конкурирующие редактирования, пустой выбор, составной артефакт внутри самого себя, отсутствие у инициатора прав на часть содержимого.

### 5.2 openComposite(compositeId, depth)

1. Проверить ACL на composite.
2. На каждый дочерний элемент **отдельно** применить ACL; скрытые элементы не возвращать (в том числе их названия, количество, IDs и provenance, если это раскрывает закрытую информацию).
3. Отрисовать разрешённые узлы и границы; с запрошенной глубиной рекурсивно раскрыть вложенные compositions.
4. Использовать стабильные ID и breadcrumbs для перехода обратно к родительской композиции.

### 5.3 Bridge(M, N)

Та же операция, что для атомарных A/B. `BridgeEngine` принимает два `ArtifactRef` и запрашивает **разрешённый `interface view`** через Gateway.

- По умолчанию агент видит boundary/contract/summary, а не внутреннее содержимое.
- C может видеть полный разрешённый ему граф и предложить мост или запросить новые disclosure.
- A/B продолжают получать только собственный scope + выданные гранты. **Участие M в качестве anchor не транзитивно передаёт права на его участников.**
- Порождаемые мосты сохраняют `sourceRevisionIds` обеих сторон, авторство, контекст доступа, конфликты и approval status.
- Перегенерация parent summary должна пометить `stale` зависимые мосты; автоматическое обновление только после явного подтверждения (политика настраивается).

### 5.4 Compose снова

После Bridge(M,N) можно выбрать `M, C, N` и связи, создать `P = Compose(...)`. Внутри `P` находятся M/N **как ссылки на составные артефакты** (без дублирования их деревьев). Визуально это вложенные пирамиды; по данным — DAG членства + отдельный semantic graph.

## 6. ACL и изоляция агентов (критично)

**Угрозы:** composite summary может случайно раскрыть приватные факты стороны B стороне A; графовая выборка может выдать скрытые узлы через вложенную membership; поиск может протечь через индексы, auto-complete и counts.

Правила:

1. Политика составного артефакта задаётся независимо от политик его потомков. Создатель должен явно авторизовать публикацию **каждого утверждения** в contract.
2. Из общедоступного составного интерфейса разрешено отдавать лишь очищенные и одобренные claims; **C может видеть больше, чем A/B**, но C не вправе обойти механизм disclosure при распространении.
3. `getComposite`, `search`, `expand`, `graph traversal`, `export`, `events`, `audit` требуют ACL-фильтрации на сервере. Отображение в Web — не security boundary.
4. A не может в запросе выдать себя за C или подставить `scope=B`; principal получается из серверной проверенной сессии/токена.
5. Revocation отсекает доступ со следующего запроса; уже выданный контент нельзя «забыть» у LLM, поэтому раскрытия должны быть минимальными и логируемыми.
6. Утверждения, полученные из приватных источников, сохраняют provenance; композиция не отмывает их в `public` автоматически.
7. Для A/B лучше отдавать специализированный sanitized `ArtifactView`, а не сериализовать всю ORM-сущность и потом удалять поля.

## 7. API (предложение, адаптировать к существующим endpoint'ам)

```http
POST /projects/:projectId/composites
GET  /projects/:projectId/composites/:id
GET  /projects/:projectId/composites/:id/members?depth=1
PATCH /projects/:projectId/composites/:id
POST /projects/:projectId/composites/:id/revisions
POST /projects/:projectId/relations/:relationId/expand
POST /projects/:projectId/bridges   # принимает atomic или composite anchors
GET  /projects/:projectId/graph?root=:id&depth=2&mode=collapsed
```

Пример `POST .../composites`:

```json
{
	"title": "История Бертиля до кораблекрушения",
	"memberArtifactIds": ["a1", "c1", "a2"],
	"memberRelationIds": ["r1", "r2"],
	"boundary": { "entries": ["a1"], "exits": ["a2"] },
	"contract": {
		"summary": "Цепочка решений и последствий перед кораблекрушением",
		"entryConditions": [],
		"exitConditions": [],
		"invariants": [],
		"keyClaims": [],
		"openQuestions": []
	},
	"visibilityScope": "C",
	"expectedProjectVersion": 12
}
```

В ответе — id, revision, inferred boundary, warnings по unresolved external edges, audit event. Ошибки: `403 unauthorized member`, `409 stale revision`, `422 membership cycle / invalid relation`, без утечки скрытых метаданных.

## 8. Web UX (существующий Graph / Fractal / Timeline)

### MVP пользовательский сценарий

1. В `Graph` выделить несколько связанных узлов (lasso/multi-select или через outline).
2. Действие **Create composite from selection**.
3. Открыть drawer: название, summary, вход/выход, что входит, внешние связи, policy и предупреждения.
4. Нажать **Compose** — на canvas появляется большая карточка `COMPOSITE` с индикатором вложенных уровней и управлением `Open / Collapse`.
5. Выделить второй подграф и аналогично создать второй composite.
6. Соединить два composites обычной командой `Bridge` (ровно как любые два простых блока).
7. Создать `C`, раскрыть `M↔C`, `C↔N`; при необходимости скомпоновать весь фрагмент как новую арку `P`.

### Визуализация без потери смысла

- `Graph`: hierarchical compound view; виртуальные aggregated edges явно отличать от сохранённых causal relations; выбор/фокус/zoom на составной блок.
- `Fractal`: каждая мини-пирамида может стать узлом новой пирамиды; двойной клик входит внутрь; breadcrumbs `Universe / Story / Arc / Scene` — только навигационные ярлыки.
- `Timeline`: составной блок показывает временной интервал/summary; раскрытие показывает составляющие события по времени; **причинность ≠ хронология**.
- `Outline`: составные узлы раскрываются вложенными строками; если один узел входит в несколько composites — ссылаться на один ID, не создавать дубликаты данных.
- Inspector: вкладки `Overview`, `Boundary`, `Members`, `External edges`, `Revisions`, `Access`, `Derivation`.
- Поиск и экспорт соблюдают ACL, depth и режим представления.

### UX-оговорка

**Collapse/uncollapse не обязан менять БД.** Состояние раскрытых карточек — пользовательская настройка (client state или saved view). **Compose меняет БД** и создаёт новую самостоятельную сущность.

## 9. Миграция из текущего прототипа

На скриншотах уже есть `39 artifacts`, `67 relations`, `31 accepted bridges`, представления `Graph/Fractal/Timeline`, роли A/B/C и disclosures. Не перегенерировать этот материал и не переписывать существующие мосты.

### Этап 0: инвентаризация

- Прочитать существующие модели artifact/relation/bridge/expansion, ACL, grants, audit, graph projections.
- Проверить, хранятся ли связи отдельными сущностями, как устроены ревизии и какие проверки уже реализованы.
- Зафиксировать схему через ADR, не размножать почти одинаковые сущности.

### Этап 1: storage + доменная операция

- Добавить `kind='composite'`, `CompositeDefinition` и membership; миграция backward-compatible (существующие = atomic).
- Реализовать `composeArtifacts`, `getCompositeView`, `validateMembership`; включить optimistic concurrency.
- Все записи в транзакциях; аудировать изменение contract и состава.

### Этап 2: read model / graph projection

- Научить graph selectors возвращать atomic/composite и агрегированные границы.
- Поддержать раскрытие N уровней, ограничение размера графа, memoization и запрет циклов.
- Не изменять логику существующих `bridge expansion` для атомарных узлов.

### Этап 3: web

- Multi-select → Compose drawer → composited card → Open/Collapse → breadcrumb.
- `Graph`, затем `Fractal`, затем `Timeline`. Сначала работающий end-to-end workflow, потом polish.

### Этап 4: bridge + ACL

- Обобщить bridge inputs на любой artifact kind.
- Завести версии контрактов и stale detection для мостов.
- Security tests для nested access и metadata leakage.

## 10. Acceptance criteria / definition of done

- [ ] Пользователь выбирает **минимум 3 узла** с отношениями, создаёт `M`, видит одну карточку и может раскрыть исходный граф без потери ID/связей.
- [ ] Можно создать `N` из другого фрагмента и связать `M,N` новым мостом `C`.
- [ ] Можно создать `P = Compose(M,C,N)` и раскрыть его последовательно `P → M,C,N → атомарные узлы`.
- [ ] Удаление/архивация композиции не удаляет участников или их отношения; поведение удаления определить и покрыть тестом.
- [ ] Повторное использование узла в двух композициях не дублирует сам артефакт.
- [ ] Невозможно создать рекурсивный membership цикл, включая вложенные композиции.
- [ ] Сохраняются ревизии, происхождение, owner и audit trail.
- [ ] Graph/Fractal/Timeline не показывают «ложное» сохранённое причинное ребро вместо агрегированного.
- [ ] Роль A не получает B-only дочерние данные через composite API, поиск, экспорт, count или ошибку.
- [ ] Существующие atomic artifacts и accepted bridges продолжают работать без миграции контента.
- [ ] После изменения interface revision устаревшие dependent bridges отмечаются и не переписываются молча.

## 11. Тестовая матрица

**Unit:** snapshot состава, boundary detection, cycle detection, repeated membership, stale refs, ACL projection.  
**Integration:** Compose → Bridge → Compose → Open; транзакционный rollback; параллельное редактирование; ACL через Gateway.  
**E2E:** Graph multiselect → create composite → collapse → connect → bridge → reopen nested; Timeline/Fractal navigation.  
**Security:** попытки прочитать вложенные B-only artifacts ролью A; поиск по приватным названиям; side-channel counts; export; forged principal; revoked grants.  
**Property-based (желательно):** collapse+open сохраняет идентичности и внутренние связи; в membership DAG никогда нет циклов.

## 12. Out of scope для первого PR

- Автономный LLM, который сам решает, что нужно компоновать; достаточно ручного выбора.
- Полноценная автоматическая семантическая свёртка тысяч узлов с гарантией истинности summary.
- Физическое копирование/переписывание внутренних артефактов при Compose.
- Наследование всех прав членов составного узла; это небезопасно.
- Новый движок layout с нуля, если можно расширить текущий Svelte Flow.

## 13. Поручение Claude Code / разработчику

> Прочитай существующий `ARCHITECTURE.md` и этот `COMPOSITE_ARTIFACTS_SPEC.md`. Изучи **реальные** модели и API репозитория, сначала составь короткий implementation plan с точными файлами миграций и компонентами. Реализуй составные артефакты как **обратимую, версионируемую семантическую композицию подграфов**, не подменяя её визуальной группировкой. Все артефакты — атомарные и составные — должны проходить через один и тот же bridge/expansion pipeline. Сохраняй внутренние ID, связи, версии, provenance и ACL. Изоляция A/B не должна ломаться при вложенной композиции. Разделяй `Collapse` (UI) и `Compose` (домен), `openComposite` (UI) и `expandRelation` (генерация). Выполни MVP end-to-end: выделение подграфа → Compose(M), Compose(N) → Bridge(M,N) → Compose(P) → рекурсивное раскрытие. Добавь миграционные, интеграционные и security-тесты. Ничего не удаляй из текущей модели без явного ADR и проверки совместимости.

---

**Главный критерий архитектуры:** после любого числа циклов `Compose ↔ Bridge/Expand` система остаётся навигируемым, проверяемым, недеструктивным графом артефактов с контролируемыми границами доступа.
