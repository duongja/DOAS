# Diaries of a Soldier — Assistant + Mission Console

A full-stack goal audit and realignment app built on the physics work equation:

```
W = F · d · cos(θ)
```

translated into:

```
Impact = Effort × Progress × Alignment
```

The primary interface is now a **minimal chat assistant**. You talk to it like a chief of staff; it can create objectives, file debriefs, read the dashboard, answer questions about history, and maintain a markdown second brain inspired by Karpathy’s LLM knowledge-base workflow.

Every debrief is still evaluated **on the server**. The browser sends only raw deployment inputs; Express passes them through the TypeScript logic engine, computes alignment, impact, burnout, and tactical feedback, and persists the fully evaluated log in MongoDB.

The UI is pure HTML + CSS + client-side TypeScript — no React, no localStorage.

- `/` — assistant / second brain
- `/dashboard.html` — mission console for direct manual oversight

---

## Stack

| Layer | Technology |
| --- | --- |
| API | Express 5 + TypeScript |
| Database | MongoDB + Mongoose |
| Assistant | OpenCode Zen (OpenAI-compatible Chat Completions) + server-side tool loop |
| Second brain | MongoDB markdown wiki + raw sources + conversation log |
| Validation | Explicit request validators + Mongoose schema validation |
| Client | Vanilla HTML, CSS, TypeScript, native `fetch()` |
| Dev runner | `ts-node-dev` + Vite (proxy `/api` → Express) |
| Production | Compiled Express server serves `dist/client` |
| Vercel | Single Express Function (`api/index.js`) + static Vite output |

---

## Quick start

### 1. Install

```bash
npm install
```

### 2. Start MongoDB

Using Docker:

```bash
docker compose up -d
```

Or point `MONGODB_URI` at an existing MongoDB instance.

### 3. Configure

```bash
cp .env.example .env
```

Defaults:

```env
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/diaries_of_a_soldier
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173

OPENCODE_API_KEY=
OPENCODE_MODEL=deepseek-v4.1-flash
OPENCODE_BASE_URL=https://opencode.ai/zen/v1
```

The server falls back to the local MongoDB URI if `MONGODB_URI` is omitted. The assistant stays offline until `OPENCODE_API_KEY` is set; the dashboard and database APIs continue to work.

### 4. Run

```bash
npm run dev
```

- API: `http://127.0.0.1:4000`
- Assistant: `http://127.0.0.1:5173`
- Mission console: `http://127.0.0.1:5173/dashboard.html`

Vite proxies `/api` requests to Express during development.

### 5. Production build

```bash
npm run build
npm start
```

`npm run build` compiles the server to `dist/` and the client to `dist/client/`. Express serves the client build and provides the SPA fallback.

---

## Deploying to Vercel (Hobby)

### Live deployment

- **Production:** https://doas-nu.vercel.app
- **Vercel project:** `nashons-projects/doas`
- **Framework preset:** Vite
- **Deployment protection:** Vercel Authentication is enabled; sign in with the Vercel account that owns the project.

The repository includes a Vercel configuration for a single Express function plus static Vite pages:

- `vercel.json` — builds the client to `dist/client`, routes `/api/*` to `api/index.js`, and gives the function 300 seconds / 1 GB.
- `api/index.js` — CommonJS Vercel serverless entrypoint; requires the compiled `dist/server.js` and reuses one MongoDB connection across fluid invocations.
- `src/server.ts` — skips `app.listen` and static serving when `VERCEL` is set.

### 1. Import the repo

Import `https://github.com/duongja/DOAS` in Vercel. The included `vercel.json` supplies the build and output settings.

Choose **Vite** as the Framework Preset, not Express. This repo is a static Vite frontend plus an explicit serverless API function; the Vite preset preserves the static pages while Vercel builds `api/index.js` separately.

### 2. Add environment variables

Set these in **Project → Settings → Environment Variables** for Production, Preview, and Development as appropriate:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | MongoDB Atlas SRV URI including the database name |
| `OPENCODE_API_KEY` | OpenCode key |
| `OPENCODE_MODEL` | `deepseek-v4.1-flash` |
| `OPENCODE_BASE_URL` | `https://opencode.ai/inference/go/openai/v1` or your OpenCode endpoint |
| `OPENCODE_SESSION_ID` | `diaries-of-a-soldier` when using the Go endpoint |
| `OPENCODE_TIMEOUT_MS` | `60000` (optional) |
| `CORS_ORIGIN` | Optional; same-origin requests are allowed automatically |

Vercel sets `NODE_ENV=production` automatically; do not add it manually.

Do **not** upload `.env`; `.vercelignore` excludes it. All secrets belong in Vercel’s environment settings.

### 3. Allow Vercel to reach Atlas

Serverless invocations use dynamic egress IPs. In MongoDB Atlas **Network Access**, add `0.0.0.0/0` (or use an Atlas private endpoint/VPC setup) or the API will fail to connect. The database is remote, so this is required even though local development works.

### 4. Deploy

```bash
npx vercel login
npx vercel
npx vercel --prod
```

Or connect the GitHub repository in the Vercel dashboard and redeploy from `main`.

### Hobby limits

- Function duration: **300 seconds** maximum (configured in both `vercel.json` and the function).
- Function memory: **1 GB** (configured in `vercel.json`).
- One API function handles all `/api/*` routes; the two HTML pages and assets are static CDN files.
- The assistant can take several seconds because it may call the model multiple times; the 300-second allowance covers normal tool loops.

### Verify after deploy

- `GET https://doas-nu.vercel.app/api/health` → `{ status: "ok", database: "connected" }`
- Open `https://doas-nu.vercel.app/` for the assistant and `https://doas-nu.vercel.app/dashboard.html` for the sprint planner.

---

## Project structure

```
src/
  core/                     framework-agnostic audit engine
    audit.ts                single orchestration entry point
    alignment.ts            cos θ classification
    progress.ts             binary/metric normalization
    impact.ts               Impact = F · d · cos θ
    tactical.ts             strategic verdicts
    types.ts                domain contracts
    engine.test.ts          22 engine tests
  assistant/
    agent.ts               conversation, system context, tool loop, persistence
    config.ts              OPENCODE_* configuration
    llm.ts                 OpenAI-compatible Chat Completions client
    prompt.ts              operator + second-brain system prompt
    tools.ts               tool definitions + validated execution
  models/
    schemas.ts              Mongoose Goal + Log schemas, DTO serializers
    deliverable.ts          dated deliverables / sprint plan items
    knowledge.ts            projects, conversations, messages, wiki pages, sources
  services/
    mission-service.ts      goal/log/dashboard operations (used by routes + tools)
    deliverable-service.ts  plan CRUD, completion, date validation
    memory-service.ts       wiki search, upsert, backlinks, sources, health
    conversation-service.ts projects, chats, history, legacy migration
  shared/
    types.ts                mission + deliverable API contracts
    assistant.ts            assistant + project + memory contracts
  client/
    api.ts                  typed fetch wrapper for mission + assistant APIs
  lib/
    date.ts                 local/UTC date + timestamp formatting
    format.ts               impact/coefficient/effort formatting
    plan.ts                 today/week/month ranges and labels
    icons.ts                inline SVG icon strings
  server.ts                 Express app, validation, routes, startup
  main.ts                   dashboard client controller
  assistant.ts              chat + memory-drawer controller
index.html                  minimal assistant shell
dashboard.html              mission console shell
src/assistant.css           minimal chat + memory drawer UI
src/styles.css              tactical dashboard UI
vite.config.mts             multi-page Vite build + API proxy
tsconfig.json               browser/client TypeScript
tsconfig.server.json        Node/server TypeScript
api/index.js                Vercel CommonJS serverless entrypoint
vercel.json                 Vercel build, function, and rewrite config
.vercelignore               excludes env files from deployment uploads
```

---

## REST API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/goals` | Create a strategic objective |
| `GET` | `/api/goals` | List all objectives, newest first |
| `POST` | `/api/logs` | Evaluate raw deployment inputs and persist the audit |
| `GET` | `/api/logs` | List campaign logs, reverse-chronological |
| `GET` | `/api/dashboard` | Cumulative impact, alerts, and daily summaries |
| `GET` | `/api/deliverables` | List planned/delivered outcomes (`?from=&to=&goalId=`) |
| `POST` | `/api/deliverables` | Add a dated deliverable to the plan |
| `PATCH` | `/api/deliverables/:id` | Rename, reschedule, edit, or complete a deliverable |
| `DELETE` | `/api/deliverables/:id` | Remove a deliverable |
| `POST` | `/api/assistant/chat` | Run one assistant turn with tool execution |
| `GET` | `/api/assistant/status` | Report whether OpenCode is configured |
| `GET` | `/api/assistant/history` | Read a conversation (`?conversationId=`; latest if omitted) |
| `GET` | `/api/projects` | List projects with nested chats |
| `POST` | `/api/projects` | Create a project folder |
| `POST` | `/api/conversations` | Create an empty chat inside a project |
| `PATCH` | `/api/conversations/:id` | Rename a chat |
| `DELETE` | `/api/conversations/:id` | Delete a chat and its messages |
| `GET` | `/api/brain/pages` | List or search wiki pages (`?q=`) |
| `GET` | `/api/brain/pages/:slug` | Read one wiki page with backlinks |
| `GET` | `/api/brain/health` | Wiki/source/orphan statistics |
| `GET` | `/api/health` | API + Mongo connection health |

### `POST /api/goals`

```json
{
  "title": "Ship the Field Manual",
  "movableObject": "Manuscript words drafted",
  "immovableWallBehaviors": ["Inbox zero", "Tool shopping", "Research spiral"]
}
```

Returns `201` with the created goal, including its Mongo `id`.

### `POST /api/logs`

```json
{
  "goalId": "66f1c2...",
  "description": "Drafted 1,200 words on the manuscript",
  "duration": 90,
  "effort": 8,
  "progress": true
}
```

The request is validated strictly:

- `description`: 3–1000 characters
- `duration`: number, 0–1440 minutes
- `effort`: integer, 1–10
- `progress`: boolean
- `goalId`: valid MongoDB ObjectId that exists

**Evaluated fields cannot be supplied by the client.** Any `calculatedImpact`, `calculatedAlignment`, `strategicFeedback`, etc. in the request body are ignored. The server recomputes everything from the raw inputs.

The response includes the enriched audit:

```json
{
  "id": "66f1c3...",
  "goalId": "66f1c2...",
  "goalTitle": "Ship the Field Manual",
  "description": "Drafted 1,200 words on the manuscript",
  "duration": 90,
  "effort": 8,
  "progress": true,
  "calculatedAlignment": 1,
  "calculatedImpact": 8,
  "strategicFeedback": "⚡ Mission Successful: Optimal energy transfer achieved. Vector is holding target direction.",
  "timestamp": "2026-11-03T12:00:00.000Z",
  "alignmentType": "direct",
  "alignmentRationale": "High-leverage action ...",
  "impactBand": "exceptional",
  "tacticalCode": "MISSION_SUCCESS",
  "tacticalHeadline": "Mission Successful",
  "severity": "success",
  "directives": ["..."],
  "burnoutWarning": false,
  "formula": "8.0 × 1.00 × 1.00 = 8.00"
}
```

### `GET /api/dashboard`

```json
{
  "totalStrategicImpact": 8,
  "activeAlerts": 1,
  "totalLogs": 2,
  "totalGoals": 1,
  "averageAlignment": 0.6,
  "burnoutFlags": 1,
  "displacementRate": 0.5,
  "dailyMetrics": [
    { "date": "2026-11-03", "impact": 8, "effort": 17, "logs": 2, "alerts": 1 }
  ],
  "generatedAt": "2026-11-03T12:00:00.000Z"
}
```

- **Total strategic impact** is the sum of every evaluated log.
- **Active alerts** counts `warning` or `critical` verdicts from the last 7 days.
- **Daily metrics** are grouped by UTC date.
- **Burnout flags** counts logs where high effort produced no positive displacement.
- **Displacement rate** is the share of logs with `progress === true`.

---

## Assistant & Second Brain

The assistant is a server-side tool loop. The browser never sees the API key and never computes mission scores.

### Flow

1. `POST /api/assistant/chat` resolves the active chat, or creates a new chat inside the requested project, then stores the user message.
2. The server builds context from:
   - the current project name,
   - all current objectives,
   - the last-7-day dashboard totals,
   - the most recent 24 wiki pages (the memory index),
   - the last complete user/assistant exchanges.
3. It calls OpenCode’s OpenAI-compatible Chat Completions endpoint with tool definitions.
4. Tool calls are validated and executed against MongoDB/the audit engine.
5. Tool results go back to the model until it produces a final answer.
6. The final answer, action chips, and any errors are persisted; the chat title/preview and project ordering are updated.

The loop is capped at 8 steps and ignores duplicate tool calls to prevent runaway writes.

### Projects & chats

The assistant uses a ChatGPT-style project sidebar:

- **Projects** are folders. `General` is created automatically and is the default.
- **Chats** live inside projects. A project can hold any number of independent chats.
- The first message in a new chat creates the conversation and auto-titles it from that message.
- The project header can be collapsed; its `+` button starts a new chat inside that project.
- Chats can be renamed or deleted from the sidebar. New messages update the chat preview, timestamp, and project ordering.
- The active project name is included in the model’s system context, so the assistant knows where it is working.
- The original single-thread app is migrated into `General` on first startup, preserving its messages.

### Tools

| Tool | What it does |
| --- | --- |
| `list_goals` | Read objectives and IDs |
| `create_goal` | Create an objective |
| `log_debrief` | File raw work inputs; server computes impact/alignment/feedback |
| `plan_deliverable` | Add a dated outcome to today/week/month |
| `list_deliverables` | Read the sprint plan, optionally by date range/objective |
| `complete_deliverable` | Mark an outcome delivered |
| `update_deliverable` | Rename, reschedule, edit, or change status |
| `get_dashboard` | Read totals, alerts, burnout, daily metrics |
| `search_logs` | Search or list recent debriefs |
| `save_memory` | Create/update an atomic markdown wiki page |
| `search_memory` | Keyword search across the wiki |
| `read_memory_page` | Read a page with backlinks |
| `list_memory_pages` | Browse recent pages |
| `capture_source` | Store raw source material |
| `list_sources` | List recently captured raw sources |
| `read_source` | Re-read an original source |
| `memory_health` | Find orphans and pages missing summaries |

### Second-brain model

The LLM maintains the wiki; the user rarely edits it directly.

- **Raw sources** — `KnowledgeSource`: title, URL, markdown, tags.
- **Compiled wiki** — `KnowledgePage`: slug, title, summary, markdown, tags, links, source IDs. Backlinks are calculated from other pages’ `links`.
- **Projects** — `Project`: a named folder grouping chats.
- **Conversations** — `Conversation` + `AssistantMessage`: a chat inside a project, with title, preview, last-message time, and visible messages/action chips.
- **Memory index** — the most recently updated page summaries are injected into every system prompt.
- **Retrieval** — keyword search with a recent-page index, deliberately avoiding embedding/RAG infrastructure at personal scale (the Karpathy approach).
- **Filing back** — when an answer is durable, the assistant can save it as a page and link it to related slugs.
- **Linting** — `memory_health` reports orphans and missing summaries so the assistant can clean up the wiki.

The brain drawer at `/` exposes search, recent pages, backlinks, tags, and a health summary. Raw sources are available to the assistant through tools.

### Model configuration

Default:

```env
OPENCODE_BASE_URL=https://opencode.ai/zen/v1
OPENCODE_MODEL=deepseek-v4.1-flash
```

This uses the OpenAI-compatible `/chat/completions` shape. Other OpenCode endpoints can be selected with `OPENCODE_BASE_URL`:

- Zen: `https://opencode.ai/zen/v1`
- Console pay-as-you-go: `https://opencode.ai/inference/openai/v1`
- Go: `https://opencode.ai/inference/go/openai/v1`

The Go endpoint requires an `x-opencode-session` header. Set `OPENCODE_SESSION_ID` and the server will send it with every model request.

Pick a Chat Completions model. `deepseek-v4.1-flash` is the default because it is fast and supports the OpenAI-compatible tool-call format.

### Safety

- The API key is server-only; it is never sent to the browser.
- The model cannot submit calculated scores. `log_debrief` passes raw inputs to the same audit engine used by the REST API.
- The assistant has no delete tools. Writes are limited to creating goals, filing debriefs, and saving/updating memory pages.
- Memory/source content is explicitly treated as data; the system prompt forbids following instructions found inside it.
- There is no authentication. Keep this deployment local or add auth before exposing it publicly.

---

## Mongoose models

### Project

```ts
{
  name: string;        // unique folder name
  createdAt: Date;
  updatedAt: Date;
}
```

### Conversation

```ts
{
  key: string;             // internal unique identifier
  projectId: ObjectId;     // project folder
  title: string;           // auto-titled from first message
  preview: string;         // last reply preview for the sidebar
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Deliverable

```ts
{
  goalId: ObjectId;
  goalTitle: string;        // snapshot for the plan view
  title: string;            // concrete outcome
  details: string;          // optional definition of done
  plannedDate: string;      // local YYYY-MM-DD
  status: 'planned' | 'delivered';
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### Goal

```ts
{
  title: string;
  movableObject: string;
  immovableWallBehaviors: string[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Log

Required production fields:

```ts
{
  goalId: ObjectId;
  goalTitle: string;          // snapshot for journal readability
  description: string;
  duration: number;
  effort: number;
  progress: boolean;
  calculatedAlignment: number;
  calculatedImpact: number;
  strategicFeedback: string;
  timestamp: Date;
}
```

Server-enriched fields also stored for the console:

```ts
{
  alignmentType: 'direct' | 'wall' | 'neutral' | 'counter';
  alignmentRationale: string;
  impactBand: ImpactBand;
  tacticalCode: TacticalCode;
  tacticalHeadline: string;
  severity: TacticalSeverity;
  directives: string[];
  burnoutWarning: boolean;
  formula: string;
}
```

Indexes:

- `projects.updatedAt` descending
- `projects.name` unique
- `conversations.projectId + lastMessageAt` compound
- `conversations.lastMessageAt` descending
- `deliverables.plannedDate + createdAt`
- `deliverables.status + plannedDate`
- `deliverables.goalId + plannedDate`
- `goals.createdAt` descending
- `logs.timestamp` descending
- `logs.goalId + logs.timestamp` compound

---

## How the server uses the existing engine

`src/server.ts` maps the simplified Mongo goal into the existing `Goal` contract:

- `movableObject` string → `movableObject.metric`
- `immovableWallBehaviors` → `BehaviorPattern[]`
- each wall behavior is matched by its full label plus its significant tokens
- no high-leverage actions are configured in this schema, so direct alignment comes from references to the movable-object metric

The raw log is mapped to a binary `DailyLog`, then:

```ts
const audit = auditDailyLog(engineGoal, engineLog);
```

The resulting `cos θ`, impact, band, tactical verdict, directives, burnout flag, formula, and rationale are persisted atomically in the log document.

This keeps the calculation logic in one place and lets the same engine run in tests, a CLI, or another transport.

---

## Client behaviour

### Assistant — `src/assistant.ts`

- Loads `/api/assistant/status`, `/api/projects`, and the latest or selected chat history.
- Renders the project/folder sidebar with nested chats, active project/chat state, new chat, new project, rename, and delete.
- Sends messages to `/api/assistant/chat` with either `conversationId` or `projectId`; the first message in a new chat creates and auto-titles it.
- Opens the memory drawer: search, page list, markdown reader, backlinks, and health stats.
- Shows a clear offline banner and disables the composer until `OPENCODE_API_KEY` is configured.
- Uses a small safe markdown renderer (headings, lists, tables, code, links, bold/italic); all content is HTML-escaped before formatting.
- No localStorage, sessionStorage, or client-side score calculation. Sidebar collapse state is in-memory only.

### Mission console — `src/main.ts`

- On load: `GET /api/goals` and `GET /api/deliverables` in parallel.
- The dashboard is a delivery planner, not a time tracker. It never displays hours or effort.
- **Today’s plan** is the default view: a clear todo list of the active day’s outcomes.
- **This week** shows a Monday–Sunday timeline. **This month** shows the month’s dated deliverables.
- Tabs show `delivered/total` counts for each period.
- Add a dated deliverable from the header, the empty state, or an empty week day.
- Click a deliverable to mark it delivered/planned; delete it with the × action.
- The Add Deliverable modal selects the objective, outcome, date, and optional definition of done.
- Goal modal: `POST /api/goals`, then opens the deliverable planner for the new objective.
- All API text is HTML-escaped before insertion into templates.
- API failures surface a retry banner and inline form errors.
- The server is the source of truth after every mutation.
- Deliberately no time fields, timesheet, trend chart, audit gauge, classifier evidence, or expandable debrief details.

---

## Scripts

```bash
npm run dev          # API (ts-node-dev) + Vite client
npm run dev:server   # API only
npm run dev:client   # Vite only
npm test             # engine unit tests
npm run typecheck    # client + server TypeScript
npm run build        # server -> dist, client -> dist/client
npm start            # run compiled server
```

---

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | Express listen port |
| `HOST` | `127.0.0.1` | API bind address; set `0.0.0.0` in a container/proxy deployment |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/diaries_of_a_soldier` | Mongo connection string |
| `CORS_ORIGIN` | localhost Vite origins | Comma-separated browser origins; same-origin is always allowed |
| `NODE_ENV` | `development` | Controls request logging and the health payload; static serving is enabled whenever `dist/client/index.html` exists |
| `OPENCODE_API_KEY` | empty | Server-only OpenCode key; assistant is disabled until set |
| `OPENCODE_MODEL` | `deepseek-v4.1-flash` | Chat Completions model ID |
| `OPENCODE_BASE_URL` | `https://opencode.ai/zen/v1` | OpenAI-compatible base URL |
| `OPENCODE_SESSION_ID` | empty | Sent as `x-opencode-session`; required by the OpenCode Go endpoint |
| `OPENCODE_TIMEOUT_MS` | `60000` | Model request timeout |

In production, set `CORS_ORIGIN` to the deployed web origin unless the API is served from the same origin (the default static deployment is).

---

## Example curl flow

```bash
# Create an objective
curl -X POST http://localhost:4000/api/goals \
  -H "Content-Type: application/json" \
  -d '{"title":"Ship the Field Manual","movableObject":"Manuscript words drafted","immovableWallBehaviors":["Inbox zero","Tool shopping"]}'

# File a debrief using the returned goal id
curl -X POST http://localhost:4000/api/logs \
  -H "Content-Type: application/json" \
  -d '{"goalId":"<goal-id>","description":"Drafted 1,200 words on the manuscript","duration":90,"effort":8,"progress":true}'

# Read the dashboard
curl http://localhost:4000/api/dashboard

# Ask the assistant to operate the app
curl -X POST http://localhost:4000/api/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"I did a 90-minute drafting block and hit 1,200 words. Log it against the book."}'
```

---

## Design notes

- **Server-authoritative scores.** The client cannot submit or override calculated fields.
- **Binary progress in this API.** `progress` is a boolean, so `d` is `1` or `0`; alignment carries direction. The underlying engine still supports metric deltas.
- **Wall precedence.** A task mentioning the target metric can still be classified as a wall if it matches a configured wall behavior. This prevents busywork from being promoted to full alignment.
- **Alerts are recent by design.** “Active alerts” uses a 7-day window so an old warning does not stay active forever.
- **Delivery, not hours.** The dashboard is a plan of dated outcomes. It does not sum time worked; `duration` remains an audit input for the assistant, not a morning metric.
- **Sprint windows.** Today is the local calendar day; this week runs Monday–Sunday; this month runs from the 1st to the last day. Deliverables are scheduled by their local `plannedDate`.
- **No authentication.** This is a personal, local-first-style deployment. Add auth/session middleware before exposing it publicly.
- **Scale.** Dashboard aggregation currently loads logs and groups them in Node. For large journals, move the daily aggregation into a MongoDB pipeline; the API response shape can stay unchanged.

---

## Verification

The repository includes 26 unit tests: 22 for the audit engine plus 4 for plan periods.

```bash
npm test
```

The full-stack flow was also smoke-tested against an in-memory MongoDB:

- create goal → `201`
- direct log → `alignment 1`, `impact 8`, mission-success verdict
- wall + burnout log → `alignment 0.2`, `impact 0`, strategic alert
- dashboard totals, alerts, and daily groups
- invalid effort → `400`
- unknown goal → `404`
- production static client + browser form submission + reload persistence
- no browser console errors

The assistant loop was smoke-tested with a mock OpenAI-compatible endpoint:

- model calls `create_goal`, then `log_debrief` + `save_memory`
- server computes the debrief and returns action chips
- conversation and memory pages persist
- memory drawer lists and reads the saved page with backlinks
- dashboard route and both HTML pages build and load
- offline state correctly disables the composer until `OPENCODE_API_KEY` is set

Projects/chats were tested against the live MongoDB deployment and in the browser:

- the existing single thread migrated into the `General` project
- project create/list
- nested conversation create, rename, history read, and delete
- UI: create a project, start a new chat inside it, send the first message, auto-title the chat, see it nested in the folder, and switch back to a chat in another project
- invalid project/chat IDs return validation/404 responses
- no browser console errors

The delivery planner is covered by API and browser checks:

- create/list/patch/delete deliverables
- deliveredAt set on completion
- local today, Monday–Sunday week, and full-month ranges
- tabs and period headings switch correctly
- add deliverable from the header, then check it off
- delivered counts and row styling update
- desktop and mobile layouts have no horizontal overflow
- no browser console errors

Live OpenCode Go was also verified:

- status reports configured
- a read-only assistant turn read the real objectives/dashboard and returned a tactical summary
- chat history, project context, and markdown/table rendering worked
