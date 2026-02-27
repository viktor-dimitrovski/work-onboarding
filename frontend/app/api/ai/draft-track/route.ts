import { NextRequest, NextResponse } from 'next/server';

type TaskType =
  | 'read_material'
  | 'video'
  | 'checklist'
  | 'quiz'
  | 'code_assignment'
  | 'external_link'
  | 'mentor_approval'
  | 'file_upload';

interface DraftTask {
  title: string;
  instructions?: string | null;
  task_type: TaskType;
  estimated_minutes?: number;
  required?: boolean;
}

interface DraftPhase {
  title: string;
  description?: string | null;
  tasks: DraftTask[];
}

const SYSTEM_PROMPT = `You turn unstructured onboarding notes into structured onboarding track phases/tasks.
Return compact JSON only (no prose).

Follow this schema:
{
  "phases": [
    {
      "title": "string",
      "description": "string",
      "tasks": [
        {
          "title": "string",
          "task_type": "read_material|video|checklist|quiz|code_assignment|external_link|mentor_approval|file_upload",
          "instructions": "string",
          "estimated_minutes": number,
          "required": boolean
        }
      ]
    }
  ]
}

Rules:
- 3-6 phases typical; 2-6 tasks per phase.
- Task titles concise; instructions actionable.
- estimated_minutes integer 5-120; default 30 if unclear.
- required=true unless clearly optional.
- Use task_type that best matches intent.
- Preserve any user-provided constraints, tech stack, or compliance notes.
- Avoid markdown, code fences, bullet lists outside JSON.
`;

const JSON_SCHEMA = {
  name: 'onboarding_track',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['phases'],
    properties: {
      phases: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'description', 'tasks'],
          properties: {
            title: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            tasks: {
              type: 'array',
              minItems: 1,
              maxItems: 20,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'task_type', 'instructions', 'estimated_minutes', 'required'],
                properties: {
                  title: { type: 'string', minLength: 1 },
                  task_type: {
                    type: 'string',
                    enum: [
                      'read_material',
                      'video',
                      'checklist',
                      'quiz',
                      'code_assignment',
                      'external_link',
                      'mentor_approval',
                      'file_upload',
                    ],
                  },
                  instructions: { type: 'string' },
                  estimated_minutes: { type: 'integer', minimum: 5, maximum: 120 },
                  required: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  },
  strict: true,
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeStringify(value: unknown, maxLen = 50_000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + `\n... (truncated ${text.length - maxLen} chars)`;
  } catch {
    return '"[unserializable]"';
  }
}

function getUpstreamRequestId(resp: Response): string | null {
  return resp.headers.get('x-request-id') ?? resp.headers.get('x-openai-request-id');
}

function extractResponsesRefusal(data: any): string {
  if (typeof data?.refusal === 'string' && data.refusal.trim()) return data.refusal.trim();

  const output = data?.output;
  if (!Array.isArray(output)) return '';

  for (const item of output) {
    if (!item || item.type !== 'message') continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;

    for (const c of content) {
      // Common shape:
      // { type: "refusal", refusal: "..." }
      if (c && c.type === 'refusal') {
        if (typeof c.refusal === 'string' && c.refusal.trim()) return c.refusal.trim();
        if (typeof c.text === 'string' && c.text.trim()) return c.text.trim();
      }
    }
  }

  return '';
}

/**
 * Extract best-effort text output from the Responses API payload.
 * Supports both:
 *  - `output_text` convenience field (if present)
 *  - `output` array with `message` items that contain content parts
 */
function extractResponsesText(data: any): string {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;

  const output = data?.output;
  if (!Array.isArray(output)) return '';

  const parts: string[] = [];
  for (const item of output) {
    if (!item || item.type !== 'message') continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;

    for (const c of content) {
      // Common shapes:
      // { type: "output_text", text: "..." }
      // { type: "text", text: "..." }
      if (c && (c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string') {
        parts.push(c.text);
      }
    }
  }

  return parts.join('\n').trim();
}

function parseJsonFromText(text: string): { phases?: unknown[] } | null {
  if (!text || typeof text !== 'string') return null;

  try {
    return JSON.parse(text);
  } catch {
    // Attempt to extract the first JSON object.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sanitizePhases(phases: unknown[] | undefined): DraftPhase[] {
  if (!Array.isArray(phases)) return [];
  return phases
    .map((phase, phaseIndex) => {
      const p = phase as DraftPhase;
      return {
        title: p?.title?.toString().trim() || `Phase ${phaseIndex + 1}`,
        description: p?.description?.toString().trim() || '',
        tasks: sanitizeTasks(p?.tasks, phaseIndex),
      };
    })
    .filter((p) => p.tasks.length > 0);
}

function sanitizeTasks(tasks: unknown[] | undefined, phaseIndex: number): DraftTask[] {
  if (!Array.isArray(tasks)) return [];
  const allowed: TaskType[] = [
    'read_material',
    'video',
    'checklist',
    'quiz',
    'code_assignment',
    'external_link',
    'mentor_approval',
    'file_upload',
  ];
  return tasks
    .map((task, taskIndex) => {
      const t = task as DraftTask;
      const taskType = allowed.includes(t?.task_type as TaskType)
        ? (t.task_type as TaskType)
        : 'checklist';
      const minutes = Number.isFinite(t?.estimated_minutes)
        ? Math.max(5, Math.min(120, Number(t.estimated_minutes)))
        : 30;

      return {
        title: t?.title?.toString().trim() || `Task ${phaseIndex + 1}.${taskIndex + 1}`,
        instructions: t?.instructions?.toString().trim() || '',
        task_type: taskType,
        estimated_minutes: minutes,
        required: typeof t?.required === 'boolean' ? t.required : true,
      };
    })
    .filter((t) => t.title);
}

type TextFormatMode = 'json_schema' | 'json_object';

function buildTextFormat(mode: TextFormatMode) {
  if (mode === 'json_object') {
    return { type: 'json_object' } as const;
  }

  return {
    type: 'json_schema',
    name: JSON_SCHEMA.name,
    strict: JSON_SCHEMA.strict,
    schema: JSON_SCHEMA.schema,
  } as const;
}

function shouldFallbackToJsonObject(status: number, bodyText: string): boolean {
  if (status !== 400) return false;

  // Prefer structured parsing when possible.
  try {
    const parsed = JSON.parse(bodyText);
    const message = (parsed?.error?.message ?? '').toString();
    const param = (parsed?.error?.param ?? '').toString();

    if (param === 'text.format' && /json_schema/i.test(message) && /not supported/i.test(message)) {
      return true;
    }
  } catch {
    // Ignore JSON parse errors; we'll fall back to string matching.
  }

  return /text\.format/i.test(bodyText) && /json_schema/i.test(bodyText) && /not supported/i.test(bodyText);
}

async function callOpenAI(notes: string, meta: Record<string, unknown>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'OPENAI_API_KEY is not configured on the server.',
        hint: 'Set OPENAI_API_KEY in the server environment (for local dev: .env.local).',
      },
      { status: 500 },
    );
  }

  // Default to a model that your project clearly has access to.
  // (You can override with OPENAI_MODEL.)
  const model = process.env.OPENAI_MODEL || 'gpt-5.2-pro';

  const apiBase = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
  const upstreamUrl = `${apiBase}/responses`;

  const userPrompt = `User notes:\n${notes}\n\nContext:\n${safeStringify(meta)}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // If you use Project-scoped keys, set OPENAI_PROJECT_ID (recommended).
  if (process.env.OPENAI_PROJECT_ID) {
    headers['OpenAI-Project'] = process.env.OPENAI_PROJECT_ID;
  }

  async function fetchOnce(mode: TextFormatMode): Promise<Response | NextResponse> {
    // Timeout guard (production hygiene)
    const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? 25_000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));

    try {
      return await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model,
          instructions: SYSTEM_PROMPT,
          input: userPrompt,
          temperature: 0.4,
          text: { format: buildTextFormat(mode) },
        }),
      });
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      return NextResponse.json(
        {
          error: aborted ? 'OpenAI request timed out.' : 'Failed to reach OpenAI.',
          hint: aborted ? 'Increase OPENAI_TIMEOUT_MS or reduce prompt size.' : undefined,
        },
        { status: aborted ? 504 : 502 },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  const envFormat = (process.env.OPENAI_TEXT_FORMAT ?? '').toLowerCase();
  const primaryMode: TextFormatMode = envFormat === 'json_object' ? 'json_object' : 'json_schema';

  let mode: TextFormatMode = primaryMode;
  let responseOrError = await fetchOnce(mode);
  if (responseOrError instanceof NextResponse) return responseOrError;
  let response = responseOrError;

  let requestId = getUpstreamRequestId(response);

  if (!response.ok) {
    const text = await response.text();

    // Fallback: older models (e.g. gpt-3.5-turbo) don't support json_schema Structured Outputs.
    if (mode === 'json_schema' && shouldFallbackToJsonObject(response.status, text)) {
      console.warn('OpenAI model does not support json_schema; retrying with json_object', {
        model,
        requestId,
      });
      mode = 'json_object';
      responseOrError = await fetchOnce(mode);
      if (responseOrError instanceof NextResponse) return responseOrError;
      response = responseOrError;
      requestId = getUpstreamRequestId(response);
    } else {
      // Log full detail server-side, but avoid leaking it in production responses.
      console.error('OpenAI upstream error', {
        status: response.status,
        requestId,
        body: text,
      });

      const isProd = process.env.NODE_ENV === 'production';

      // Keep upstream 4xx statuses visible to callers (helps troubleshooting).
      const status = response.status >= 400 && response.status < 500 ? response.status : 502;

      const hint =
        response.status === 401 || response.status === 403
          ? 'Check OPENAI_API_KEY, project permissions, and model access. Ensure OPENAI_MODEL is enabled for this project.'
          : response.status === 429
            ? 'Rate limited. Add retries/backoff or reduce request volume.'
            : undefined;

      return NextResponse.json(
        {
          error: `Upstream OpenAI error ${response.status}`,
          request_id: requestId ?? undefined,
          hint,
          detail: isProd ? undefined : text,
        },
        { status },
      );
    }
  }

  if (!response.ok) {
    const text = await response.text();
    // Log full detail server-side, but avoid leaking it in production responses.
    console.error('OpenAI upstream error', {
      status: response.status,
      requestId,
      body: text,
    });

    const isProd = process.env.NODE_ENV === 'production';

    // Keep upstream 4xx statuses visible to callers (helps troubleshooting).
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;

    const hint =
      response.status === 401 || response.status === 403
        ? 'Check OPENAI_API_KEY, project permissions, and model access. Ensure OPENAI_MODEL is enabled for this project.'
        : response.status === 429
          ? 'Rate limited. Add retries/backoff or reduce request volume.'
          : undefined;

    return NextResponse.json(
      {
        error: `Upstream OpenAI error ${response.status}`,
        request_id: requestId ?? undefined,
        hint,
        detail: isProd ? undefined : text,
      },
      { status },
    );
  }

  const data = await response.json();
  const refusal = extractResponsesRefusal(data);
  if (refusal) {
    const isProd = process.env.NODE_ENV === 'production';
    console.warn('OpenAI refusal', { requestId, refusal });
    return NextResponse.json(
      {
        error: 'The model refused to generate a structured onboarding track for this input.',
        request_id: requestId ?? undefined,
        refusal: isProd ? undefined : refusal,
      },
      { status: 422 },
    );
  }

  const content: string = extractResponsesText(data);
  const parsed = parseJsonFromText(content);

  if (!parsed || !Array.isArray(parsed.phases)) {
    const isProd = process.env.NODE_ENV === 'production';
    console.error('Failed to parse AI response', { requestId, content });
    return NextResponse.json(
      {
        error: 'Failed to parse AI response.',
        request_id: requestId ?? undefined,
        raw: isProd ? undefined : content,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({ phases: sanitizePhases(parsed.phases) });
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const notes = (body?.notes ?? '').toString().trim();
  const metaRaw = body?.meta ?? {};
  const meta = isPlainObject(metaRaw) ? metaRaw : {};

  if (!notes || notes.length < 10) {
    return NextResponse.json(
      { error: 'Please provide more descriptive notes (at least 10 characters).' },
      { status: 400 },
    );
  }

  // Basic size guard (prevents accidental huge payload costs/timeouts)
  const maxNotes = Number(process.env.OPENAI_MAX_NOTES_CHARS ?? 25_000);
  if (notes.length > maxNotes) {
    return NextResponse.json(
      { error: `Notes too large. Limit is ${maxNotes} characters.` },
      { status: 413 },
    );
  }

  return callOpenAI(notes, meta);
}
