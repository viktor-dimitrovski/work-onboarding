'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import { BUILTIN_TEMPLATES, type ImportTemplate } from '@/lib/import-templates';
import { Label } from '@/components/ui/label';

export interface AiInstructionsPanelProps {
  /** Currently selected template id ('' = none) */
  template: string;
  onTemplateChange: (id: string) => void;

  /** Free-text material description typed by user — always blank initially */
  materialContext: string;
  onMaterialContextChange: (v: string) => void;

  /** Editable AI instructions (pre-filled by template) */
  extraInstructions: string;
  onExtraInstructionsChange: (v: string) => void;

  /** Let AI decide question count */
  autoCount: boolean;
  onAutoCountChange: (v: boolean) => void;

  /** User-created templates fetched from the API */
  userTemplates: ImportTemplate[];
}

export function AiInstructionsPanel({
  template,
  onTemplateChange,
  materialContext,
  onMaterialContextChange,
  extraInstructions,
  onExtraInstructionsChange,
  autoCount,
  onAutoCountChange,
  userTemplates,
}: AiInstructionsPanelProps) {
  const [open, setOpen] = useState(false);

  const allTemplates: ImportTemplate[] = [
    ...BUILTIN_TEMPLATES,
    ...userTemplates,
  ];

  const selectedTmpl = allTemplates.find((t) => t.id === template) ?? null;

  function handleTemplateSelect(id: string) {
    onTemplateChange(id);
    const tmpl = allTemplates.find((t) => t.id === id);
    if (tmpl) {
      onExtraInstructionsChange(tmpl.extra_instructions);
      onAutoCountChange(tmpl.auto_question_count);
      // material context is intentionally NOT pre-filled — user types it themselves
    } else {
      // "None" selected — clear instructions
      onExtraInstructionsChange('');
      onAutoCountChange(false);
    }
  }

  const contextPlaceholder =
    selectedTmpl?.context_placeholder ?? 'Describe the material you are importing…';

  return (
    <div className='rounded-md border border-dashed'>
      {/* Toggle header */}
      <button
        type='button'
        className='flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors'
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className='flex items-center gap-1.5'>
          <span className='text-primary'>✦</span>
          AI Instructions
          <span className='ml-1 text-xs font-normal text-muted-foreground'>(optional)</span>
        </span>
        {open ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
      </button>

      {open && (
        <div className='border-t px-3 pb-3 pt-3 space-y-3'>
          {/* Template selector */}
          <div className='space-y-1.5'>
            <Label htmlFor='ai-template' className='text-xs'>
              Template
            </Label>
            <div className='flex items-center gap-2'>
              <select
                id='ai-template'
                className='h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm'
                value={template}
                onChange={(e) => handleTemplateSelect(e.target.value)}
              >
                <option value=''>— None —</option>
                {BUILTIN_TEMPLATES.length > 0 && (
                  <optgroup label='Built-in'>
                    {BUILTIN_TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {userTemplates.length > 0 && (
                  <optgroup label='My templates'>
                    {userTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <a
                href='/settings#ai-import-templates'
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground whitespace-nowrap'
                title='Manage templates in Settings'
              >
                <Settings2 className='h-3.5 w-3.5' />
                Manage
              </a>
            </div>
          </div>

          {/* Material context — always blank, user types it */}
          <div className='space-y-1.5'>
            <Label htmlFor='ai-material-context' className='text-xs'>
              Describe your material{' '}
              <span className='font-normal text-muted-foreground'>(optional)</span>
            </Label>
            <input
              id='ai-material-context'
              type='text'
              className='h-9 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/60'
              placeholder={contextPlaceholder}
              value={materialContext}
              onChange={(e) => onMaterialContextChange(e.target.value)}
            />
          </div>

          {/* Instructions textarea */}
          <div className='space-y-1.5'>
            <Label htmlFor='ai-extra-instructions' className='text-xs'>
              Additional instructions for AI{' '}
              <span className='font-normal text-muted-foreground'>(editable)</span>
            </Label>
            <textarea
              id='ai-extra-instructions'
              className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 resize-y'
              rows={6}
              placeholder='e.g. Focus on understanding, use simple language, avoid trivial details…'
              value={extraInstructions}
              onChange={(e) => onExtraInstructionsChange(e.target.value)}
            />
          </div>

          {/* Auto question count */}
          <label className='flex cursor-pointer items-start gap-2.5'>
            <input
              type='checkbox'
              className='mt-0.5 h-4 w-4 rounded'
              checked={autoCount}
              onChange={(e) => onAutoCountChange(e.target.checked)}
            />
            <span className='text-sm'>
              Let AI decide question count
              <span className='ml-1 text-xs text-muted-foreground'>
                (ignores the &ldquo;Questions to generate&rdquo; number above)
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
