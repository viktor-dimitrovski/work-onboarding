export interface ImportTemplate {
  id: string;
  name: string;
  /** Shown as grey placeholder hint in the material context field — the field itself stays blank */
  context_placeholder: string;
  extra_instructions: string;
  auto_question_count: boolean;
  /** True = hardcoded built-in; cannot be deleted */
  builtin?: true;
}

export const BUILTIN_TEMPLATES: ImportTemplate[] = [
  {
    id: 'history-8th',
    name: 'History — 8th Grade',
    builtin: true,
    context_placeholder: 'e.g. History lessons for 8th grade — Chapter 3: World War I',
    auto_question_count: true,
    extra_instructions: `Create questions for revision and self-evaluation so students can check how much they have learned.

Requirements:
- cover all lessons/material fairly and proportionally
- use language suitable for 8th grade students
- mostly multiple-choice with one correct answer
- focus on important facts, causes, consequences, and comparisons
- avoid trivial OCR noise details
- difficulty mix: ~30% easy, ~50% medium, ~20% hard
- question distribution: 40% recall, 40% understanding, 20% analysis/comparison`,
  },
  {
    id: 'professional-regulations',
    name: 'Professional / Regulations',
    builtin: true,
    context_placeholder: 'e.g. EU Payment Services Directive (PSD2) — Chapter 4: Strong Customer Authentication',
    auto_question_count: false,
    extra_instructions: `Create assessment questions for professional compliance training and self-evaluation.

Requirements:
- cover the material fairly and proportionally
- use precise, professional language appropriate for industry practitioners
- mostly multiple-choice with one unambiguously correct answer
- focus on definitions, obligations, key dates, and practical implications
- avoid trivial or highly specific implementation details unless compliance-critical
- difficulty mix: ~20% easy, ~60% medium, ~20% hard
- question distribution: 50% recall of key rules, 30% understanding/application, 20% scenario-based analysis`,
  },
];
