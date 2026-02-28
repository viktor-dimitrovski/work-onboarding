"use client";

import { useEffect, useMemo, useState } from 'react';
import { $getSelection, COMMAND_PRIORITY_LOW, KEY_DOWN_COMMAND } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const COMMANDS = [
  {
    key: 'log',
    label: 'Insert log entry',
    template: () => `### ${new Date().toISOString()}\n- \n`,
  },
  { key: 'summary', label: 'Insert Summary section', template: () => `## Summary\n- \n\n` },
  { key: 'acceptance', label: 'Insert Acceptance / checks', template: () => `## Acceptance / checks\n- \n\n` },
  {
    key: 'versions',
    label: 'Insert Versions table',
    template: () =>
      `## Versions used during testing\n\n| Component | Version |\n|---|---|\n|  |  |\n\n`,
  },
  { key: 'implementation', label: 'Insert Implementation notes', template: () => `## Implementation notes\n- \n\n` },
  { key: 'history', label: 'Insert Dev log (history)', template: () => `## Dev log (history)\n- ${new Date().toISOString().slice(0, 10)}: \n\n` },
  {
    key: 'risks',
    label: 'Insert Risks and mitigations',
    template: () => `## Risks and mitigations\n- Risk:\n  - \n- Mitigation:\n  - \n\n`,
  },
  { key: 'rollback', label: 'Insert Rollback considerations', template: () => `## Rollback considerations\n- \n\n` },
  { key: 'deploy', label: 'Insert deploy checklist', template: () => `## Deploy checklist\n- [ ] \n\n` },
  { key: 'decision', label: 'Insert decision section', template: () => `## Decision\n- \n\n` },
];

export function SlashMenu() {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const items = useMemo(() => {
    if (!query.trim()) return COMMANDS;
    const q = query.trim().toLowerCase();
    return COMMANDS.filter((cmd) => cmd.key.includes(q) || cmd.label.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          setOpen(true);
          setQuery('');
          setSelected(0);
          return false;
        }
        if (!open) return false;
        if (event.key === 'Escape') {
          setOpen(false);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelected((prev) => Math.min(prev + 1, Math.max(0, items.length - 1)));
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelected((prev) => Math.max(prev - 1, 0));
          return true;
        }
        if (event.key === 'Enter') {
          const pick = items[selected];
          if (pick) {
            editor.update(() => {
              const selection = $getSelection();
              if (selection) {
                selection.insertText(pick.template());
              }
            });
          }
          setOpen(false);
          return true;
        }
        if (event.key === 'Backspace') {
          setQuery((prev) => prev.slice(0, -1));
          return false;
        }
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          setQuery((prev) => prev + event.key);
          return false;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, open, items, selected]);

  if (!open) return null;

  return (
    <div className='absolute right-4 top-4 z-20 w-64 rounded-md border bg-white shadow-lg'>
      <div className='border-b px-3 py-2 text-xs text-muted-foreground'>
        Slash menu: {query || 'type to filter'} (Enter to insert)
      </div>
      <div className='max-h-56 overflow-auto py-1'>
        {items.length === 0 ? (
          <div className='px-3 py-2 text-xs text-muted-foreground'>No matches</div>
        ) : (
          items.map((item, idx) => (
            <Button
              key={item.key}
              type='button'
              variant='ghost'
              className={cn(
                'h-auto w-full justify-start px-3 py-2 text-left text-xs',
                idx === selected && 'bg-muted',
              )}
              onClick={() => {
                editor.update(() => {
                  const selection = $getSelection();
                  if (selection) {
                    selection.insertText(item.template());
                  }
                });
                setOpen(false);
              }}
            >
              {item.label}
            </Button>
          ))
        )}
      </div>
    </div>
  );
}
