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
Respond with compact JSON only, no prose.

Schema:
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

async function callOpenAI(notes: string, meta: Record<string, unknown>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured on the server.' },
      { status: 400 },
    );
  }

  const userPrompt = `User notes:\n${notes}\n\nContext:\n${JSON.stringify(meta, null, 2)}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json(
      { error: `Upstream OpenAI error ${response.status}`, detail: text },
      { status: 502 },
    );
  }

  const data = await response.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  const parsed = parseJsonFromText(content);
  if (!parsed) {
    return NextResponse.json(
      { error: 'Failed to parse AI response', raw: content },
      { status: 422 },
    );
  }

  return NextResponse.json({ phases: sanitizePhases(parsed.phases) });
}

function parseJsonFromText(text: string): { phases?: unknown[] } | null {
  try {
    return JSON.parse(text);
  } catch {
    // attempt to extract JSON inside code fences
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
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
      const taskType = allowed.includes(t?.task_type as TaskType) ? (t.task_type as TaskType) : 'checklist';
      const minutes = Number.isFinite(t?.estimated_minutes) ? Math.max(5, Math.min(120, Number(t.estimated_minutes))) : 30;
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

export async function POST(request: NextRequest) {
  const body = await request.json();
  const notes = (body?.notes ?? '').toString();
  const meta = body?.meta ?? {};

  if (!notes || notes.length < 10) {
    return NextResponse.json(
      { error: 'Please provide more descriptive notes (at least 10 characters).' },
      { status: 400 },
    );
  }

  return callOpenAI(notes, meta);
}
