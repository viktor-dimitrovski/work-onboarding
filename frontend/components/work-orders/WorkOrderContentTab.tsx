import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/common/markdown-renderer';
import { useAuth } from '@/lib/auth-context';
import { comboToDisplay, eventToCombo, matchesCombo } from '@/lib/hotkeys';
import {
  KEYBINDING_ACTIONS,
  KeybindingProfile,
  applyDefaultBindings,
  syncKeybindingsProfile,
} from '@/lib/keybindingsStore';
import {
  parseImageRefListToTable,
  parseKubectlOutputToTable,
  parseMarkdownTable,
  serializeMarkdownTable,
} from '@/lib/markdownTableParser';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileText,
  HelpCircle,
  Layers,
  ListPlus,
  PanelRightOpen,
  Search,
} from 'lucide-react';

type WorkOrderContentTabProps = {
  bodyMarkdown: string;
  onBodyMarkdownChange: (next: string) => void;
  onSave?: () => void;
  saveLabel?: string | null;
  localDraftLabel?: string | null;
};

type SectionDefinition = {
  id: string;
  title: string;
  heading: string;
  type: 'markdown' | 'versions' | 'devlog';
  template: string;
};

const SECTION_DEFINITIONS: SectionDefinition[] = [
  { id: 'summary', title: 'Summary', heading: 'Summary', type: 'markdown', template: '- ' },
  { id: 'acceptance', title: 'Acceptance / checks', heading: 'Acceptance / checks', type: 'markdown', template: '- [ ] ' },
  {
    id: 'versions',
    title: 'Versions used',
    heading: 'Versions used during testing',
    type: 'versions',
    template: '| Component | Version |\n|---|---|\n|  |  |',
  },
  { id: 'implementation', title: 'Implementation notes', heading: 'Implementation notes', type: 'markdown', template: '- ' },
  {
    id: 'devlog',
    title: 'Dev log',
    heading: 'Dev log (history)',
    type: 'devlog',
    template: '- ',
  },
  {
    id: 'risks',
    title: 'Risks & mitigations',
    heading: 'Risks and mitigations',
    type: 'markdown',
    template: '- Risk:\n  - \n- Mitigation:\n  - ',
  },
  { id: 'rollback', title: 'Rollback considerations', heading: 'Rollback considerations', type: 'markdown', template: '- ' },
];

const MIN_SECTION_CHARS = 24;

function isTypingElement(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') return true;
  if (el.isContentEditable) return true;
  return false;
}

function splitImageRefIntoComponentAndVersion(value: string): { component: string; version: string } | null {
  const raw = (value || '').trim();
  if (!raw) return null;

  // Docker image refs:
  // - registry/repo/image:tag
  // - registry:5000/repo/image:tag (port must NOT be treated as tag)
  // - registry/repo/image@sha256:... (digest)
  const atIndex = raw.indexOf('@');
  if (atIndex !== -1) {
    const beforeAt = raw.slice(0, atIndex).trim();
    const digest = raw.slice(atIndex + 1).trim();
    if (beforeAt && digest) return { component: beforeAt, version: digest };
  }

  const lastSlash = raw.lastIndexOf('/');
  const lastColon = raw.lastIndexOf(':');
  if (lastColon === -1 || lastColon <= lastSlash) return null;
  const before = raw.slice(0, lastColon).trim();
  const after = raw.slice(lastColon + 1).trim();
  if (!before || !after) return null;
  return { component: before, version: after };
}

function normalizeVersionsTable(table: { headers: string[]; rows: string[][] }): { headers: string[]; rows: string[][] } {
  if (!table || !Array.isArray(table.rows)) return table;
  if (table.headers.length < 2) return table;

  const rows = table.rows.map((row) => {
    const componentCell = (row?.[0] || '').trim();
    const versionCell = (row?.[1] || '').trim();
    if (!componentCell || versionCell) return [row?.[0] || '', row?.[1] || ''];
    const split = splitImageRefIntoComponentAndVersion(componentCell);
    if (!split) return [row?.[0] || '', row?.[1] || ''];
    return [split.component, split.version];
  });

  return { ...table, rows };
}

function readSection(markdown: string, heading: string): string {
  const lines = (markdown || '').split('\n');
  const headingLine = `## ${heading}`.toLowerCase();
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === headingLine);
  if (startIndex === -1) return '';
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('## ')) {
      endIndex = i;
      break;
    }
  }
  const contentLines = lines.slice(startIndex + 1, endIndex);
  while (contentLines.length && !contentLines[0].trim()) contentLines.shift();
  while (contentLines.length && !contentLines[contentLines.length - 1].trim()) contentLines.pop();
  return contentLines.join('\n');
}

function upsertSection(markdown: string, heading: string, content: string): string {
  const lines = (markdown || '').split('\n');
  const headingLine = `## ${heading}`;
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === headingLine.toLowerCase());
  if (startIndex === -1) {
    const trimmed = (markdown || '').trim();
    return trimmed ? `${headingLine}\n${content}\n\n${trimmed}\n` : `${headingLine}\n${content}\n`;
  }
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('## ')) {
      endIndex = i;
      break;
    }
  }
  const newLines = [...lines.slice(0, startIndex + 1), content, '', ...lines.slice(endIndex)];
  return newLines.join('\n');
}

function getFirstPreviewLine(content: string): string {
  const lines = (content || '').split('\n');
  const line = lines.find((row) => row.trim());
  return line ? line.trim().replace(/^[-*]\s*/, '') : '';
}

function analyzeSectionStatus(content: string) {
  const trimmed = (content || '').trim();
  if (!trimmed) {
    return { status: 'missing', reason: 'Empty section' };
  }
  if (/todo|tbd/i.test(trimmed) || /- \[ \]/.test(trimmed)) {
    return { status: 'needs-review', reason: 'Contains TODO/TBD or unchecked items' };
  }
  if (trimmed.replace(/\s/g, '').length < MIN_SECTION_CHARS) {
    return { status: 'needs-review', reason: `Less than ${MIN_SECTION_CHARS} characters` };
  }
  return { status: 'ok', reason: 'Looks complete' };
}

function SmartTextarea({
  value,
  onChange,
  placeholder,
  rows = 8,
  className,
  dataSection,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  dataSection: string;
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter') {
      const target = event.currentTarget;
      const start = target.selectionStart ?? 0;
      const text = target.value;
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = text.indexOf('\n', start);
      const currentLine = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const match = /^(\s*)(- \[ \]\s+|- )/.exec(currentLine);
      if (match) {
        event.preventDefault();
        const insert = `\n${match[1]}${match[2]}`;
        const next = `${text.slice(0, start)}${insert}${text.slice(start)}`;
        const caret = start + insert.length;
        onChange(next);
        requestAnimationFrame(() => {
          target.selectionStart = caret;
          target.selectionEnd = caret;
        });
      }
    }
  };

  return (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={cn('text-sm leading-relaxed', className)}
      onKeyDown={handleKeyDown}
      data-section={dataSection}
      data-wo-field
    />
  );
}

function renderAutoLinks(text: string) {
  const pattern = /(https?:\/\/[^\s]+|\bWO-[A-Z0-9-]+\b|\bTASK-[A-Z0-9-]+\b|#\d+)/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  text.replace(pattern, (match, _group, offset) => {
    if (offset > lastIndex) {
      parts.push(text.slice(lastIndex, offset));
    }
    if (match.startsWith('http')) {
      parts.push(
        <a key={`${match}-${offset}`} href={match} target='_blank' rel='noreferrer' className='text-primary underline'>
          {match}
        </a>,
      );
    } else {
      parts.push(
        <span key={`${match}-${offset}`} className='text-primary underline'>
          {match}
        </span>,
      );
    }
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export function WorkOrderContentTab({
  bodyMarkdown,
  onBodyMarkdownChange,
  onSave,
  saveLabel,
  localDraftLabel,
}: WorkOrderContentTabProps) {
  const { accessToken, user, hasRole } = useAuth();
  const [activeSection, setActiveSection] = useState<string>(SECTION_DEFINITIONS[0].id);
  const [sectionDrawerOpen, setSectionDrawerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutOverlayOpen, setShortcutOverlayOpen] = useState(false);
  const [shortcutSearch, setShortcutSearch] = useState('');
  const [paletteSearch, setPaletteSearch] = useState('');
  const [keybindings, setKeybindings] = useState<KeybindingProfile>(
    applyDefaultBindings({ updated_at: 0, bindings: {} }),
  );
  const [versionsWarning, setVersionsWarning] = useState<string | null>(null);
  const [versionsImportOpen, setVersionsImportOpen] = useState(false);
  const [versionsImportText, setVersionsImportText] = useState('');
  const [versionsImportError, setVersionsImportError] = useState<string | null>(null);
  const [devLogDraft, setDevLogDraft] = useState('');
  const [devLogEditing, setDevLogEditing] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!shortcutOverlayOpen) setShortcutSearch('');
  }, [shortcutOverlayOpen]);

  useEffect(() => {
    if (!paletteOpen) setPaletteSearch('');
  }, [paletteOpen]);

  useEffect(() => {
    if (!versionsImportOpen) {
      setVersionsImportText('');
      setVersionsImportError(null);
    }
  }, [versionsImportOpen]);

  useEffect(() => {
    let mounted = true;
    syncKeybindingsProfile(accessToken).then((profile) => {
      if (mounted) setKeybindings(profile);
    });
    return () => {
      mounted = false;
    };
  }, [accessToken]);

  const sections = useMemo(() => {
    return SECTION_DEFINITIONS.map((section) => {
      const content = readSection(bodyMarkdown, section.heading);
      const status = analyzeSectionStatus(content);
      return { ...section, content, status, preview: getFirstPreviewLine(content) };
    });
  }, [bodyMarkdown]);

  const completionCount = sections.filter((section) => section.status.status === 'ok').length;
  const activeDef = sections.find((section) => section.id === activeSection) ?? sections[0];

  const updateSectionContent = useCallback(
    (section: SectionDefinition, content: string) => {
      onBodyMarkdownChange(upsertSection(bodyMarkdown, section.heading, content));
    },
    [bodyMarkdown, onBodyMarkdownChange],
  );

  useEffect(() => {
    if (activeDef?.id !== 'versions') return;
    const content = readSection(bodyMarkdown, activeDef.heading);
    if (parseMarkdownTable(content)) {
      setVersionsWarning(null);
    }
  }, [activeDef, bodyMarkdown]);

  useEffect(() => {
    if (activeDef?.id !== 'versions') return;
    const content = readSection(bodyMarkdown, activeDef.heading);
    const parsed = parseMarkdownTable(content);
    if (!parsed) return;
    const normalized = normalizeVersionsTable(parsed);
    const currentSerialized = serializeMarkdownTable(parsed);
    const nextSerialized = serializeMarkdownTable(normalized);
    if (currentSerialized !== nextSerialized) {
      updateSectionContent(activeDef, nextSerialized);
    }
  }, [activeDef, bodyMarkdown, updateSectionContent]);

  const focusFirstField = useCallback(
    (sectionId: string) => {
      const container = editorRef.current;
      if (!container) return;
      const target = container.querySelector<HTMLElement>(`[data-section="${sectionId}"][data-wo-field]`);
      target?.focus();
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        const len = target.value.length;
        requestAnimationFrame(() => {
          try {
            target.setSelectionRange(len, len);
          } catch {
            // ignore
          }
        });
      }
    },
    [editorRef],
  );

  useEffect(() => {
    focusFirstField(activeSection);
  }, [activeSection, focusFirstField]);

  const addDevLogEntry = useCallback(
    (draftMessage?: string) => {
      if (!activeDef || activeDef.id !== 'devlog') return;
      const message = (draftMessage ?? devLogDraft).trim();
      if (!message) return;
      const content = readSection(bodyMarkdown, activeDef.heading);
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const author = user?.email || user?.full_name || 'user';
      const next = content.trim()
        ? `${content.trim()}\n- ${timestamp} (${author}): ${message}`
        : `- ${timestamp} (${author}): ${message}`;
      updateSectionContent(activeDef, next);
      setDevLogDraft('');
    },
    [activeDef, bodyMarkdown, devLogDraft, updateSectionContent, user],
  );

  const insertTemplate = useCallback(() => {
    if (!activeDef) return;
    const template =
      activeDef.id === 'devlog'
        ? `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} (${user?.email || user?.full_name || 'user'}): `
        : activeDef.template;
    updateSectionContent(activeDef, template);
  }, [activeDef, updateSectionContent, user]);

  const insertTemplateFor = useCallback(
    (sectionId: string) => {
      const target = SECTION_DEFINITIONS.find((section) => section.id === sectionId);
      if (!target) return;
      const template =
        target.id === 'devlog'
          ? `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} (${user?.email || user?.full_name || 'user'}): `
          : target.template;
      updateSectionContent(target, template);
      setActiveSection(target.id);
    },
    [updateSectionContent, user],
  );

  const clearSection = useCallback(() => {
    if (!activeDef) return;
    updateSectionContent(activeDef, '');
  }, [activeDef, updateSectionContent]);

  const focusSiblingField = useCallback(
    (direction: 'prev' | 'next') => {
      const container = editorRef.current;
      if (!container) return;
      const fields = Array.from(
        container.querySelectorAll<HTMLElement>(`[data-section="${activeSection}"][data-wo-field]`),
      );
      const active = document.activeElement as HTMLElement | null;
      const idx = fields.findIndex((field) => field === active);
      if (idx === -1 || fields.length === 0) return;
      const nextIdx = direction === 'next' ? Math.min(fields.length - 1, idx + 1) : Math.max(0, idx - 1);
      fields[nextIdx]?.focus();
    },
    [activeSection],
  );

  const handleAction = useCallback(
    (actionId: string) => {
      if (actionId === 'workOrder.save' && onSave) {
        onSave();
        return;
      }
      if (actionId === 'content.help.overlay.toggle') {
        setShortcutOverlayOpen((prev) => !prev);
        return;
      }
      if (actionId === 'commandPalette.open') {
        setPaletteOpen(true);
        return;
      }
      if (actionId === 'content.preview.toggle') {
        setPreviewOpen((prev) => !prev);
        return;
      }
      if (actionId === 'content.drawer.toggle') {
        setSectionDrawerOpen((prev) => !prev);
        return;
      }
      if (actionId === 'content.section.prev') {
        const idx = sections.findIndex((section) => section.id === activeSection);
        const next = sections[Math.max(0, idx - 1)];
        if (next) setActiveSection(next.id);
        return;
      }
      if (actionId === 'content.section.next') {
        const idx = sections.findIndex((section) => section.id === activeSection);
        const next = sections[Math.min(sections.length - 1, idx + 1)];
        if (next) setActiveSection(next.id);
        return;
      }
      if (actionId === 'content.field.prev') {
        focusSiblingField('prev');
        return;
      }
      if (actionId === 'content.field.next') {
        focusSiblingField('next');
        return;
      }
      if (actionId.startsWith('content.jump.section')) {
        const index = Number(actionId.split('section')[1]) - 1;
        const target = sections[index];
        if (target) setActiveSection(target.id);
        return;
      }
      if (actionId === 'content.template.insert') {
        insertTemplate();
        return;
      }
      if (actionId === 'content.copySectionMarkdown') {
        const content = activeDef ? readSection(bodyMarkdown, activeDef.heading) : '';
        if (content && navigator.clipboard) {
          void navigator.clipboard.writeText(content);
        }
        return;
      }
      if (actionId === 'versions.row.add' && activeDef?.id === 'versions') {
        const content = readSection(bodyMarkdown, activeDef.heading);
        const parsed = parseMarkdownTable(content);
        const table = parsed || { headers: ['Component', 'Version'], rows: [['', '']] };
        table.rows.push(new Array(table.headers.length).fill(''));
        updateSectionContent(activeDef, serializeMarkdownTable(table));
        return;
      }
      if (actionId === 'devlog.entry.add' && activeDef?.id === 'devlog') {
        addDevLogEntry();
        return;
      }
    },
    [
      activeDef,
      activeSection,
      bodyMarkdown,
      addDevLogEntry,
      focusSiblingField,
      insertTemplate,
      onSave,
      sections,
      updateSectionContent,
    ],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const container = containerRef.current;
      if (!container) return;
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl || !container.contains(activeEl)) return;

      // Do not steal normal typing/cursor movement inside inputs/editors.
      if (isTypingElement(activeEl)) {
        const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
        if (!hasModifier) return;
        if (event.key?.startsWith('Arrow')) return;
      }

      const combo = eventToCombo(event);
      if (!combo) return;
      const bindings = keybindings.bindings;
      const matched = Object.keys(bindings).filter((actionId) =>
        (bindings[actionId] || []).some((binding) => matchesCombo(event, binding)),
      );
      if (matched.length === 0) return;
      let action = matched[0];
      if (matched.includes('versions.row.add') && activeDef?.id === 'versions') {
        action = 'versions.row.add';
      } else if (matched.includes('devlog.entry.add') && activeDef?.id === 'devlog') {
        action = 'devlog.entry.add';
      }
      if (action === 'versions.row.add' && activeDef?.id !== 'versions') return;
      if (action === 'devlog.entry.add' && activeDef?.id !== 'devlog') return;
      event.preventDefault();
      handleAction(action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeDef, handleAction, keybindings]);

  const handleSectionClick = (sectionId: string) => {
    setActiveSection(sectionId);
    setSectionDrawerOpen(false);
  };

  const renderSectionList = (
    <div className='flex h-full flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>Sections</p>
          <p className='text-sm font-medium text-foreground'>{completionCount}/{sections.length} complete</p>
        </div>
        <span className='rounded-md border bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground'>
          {sections.length} total
        </span>
      </div>
      <ScrollArea className='flex-1 pr-2'>
        <div className='space-y-2'>
          {sections.map((section, index) => {
            const isActive = section.id === activeSection;
            const shortcut = keybindings.bindings[`content.jump.section${index + 1}`]?.[0];
            const StatusIcon =
              section.status.status === 'ok'
                ? CheckCircle2
                : section.status.status === 'needs-review'
                  ? AlertTriangle
                  : AlertCircle;
            const statusColor =
              section.status.status === 'ok'
                ? 'text-emerald-500'
                : section.status.status === 'needs-review'
                  ? 'text-amber-500'
                  : 'text-red-500';
            return (
              <button
                key={section.id}
                type='button'
                className={cn(
                  'w-full rounded-md border px-3 py-2 text-left transition-colors',
                  isActive ? 'border-primary/40 bg-primary/5' : 'border-transparent hover:border-muted',
                )}
                onClick={() => handleSectionClick(section.id)}
              >
                <div className='flex items-start justify-between gap-2'>
                  <div className='flex items-start gap-2'>
                    <StatusIcon
                      className={cn('mt-0.5 h-4 w-4', statusColor)}
                      title={section.status.reason}
                      aria-label={section.status.reason}
                    />
                    <div>
                      <p className='text-sm font-medium'>{section.title}</p>
                      <p className='mt-1 line-clamp-1 text-xs text-muted-foreground'>
                        {section.preview || 'No content yet'}
                      </p>
                    </div>
                  </div>
                  {shortcut ? (
                    <span className='rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
                      {comboToDisplay(shortcut)}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );

  const renderActiveEditor = () => {
    if (!activeDef) return null;
    if (activeDef.type === 'versions') {
      const content = readSection(bodyMarkdown, activeDef.heading);
      const parsed = parseMarkdownTable(content);
      const isEmpty = !content.trim();
      if (!parsed && !isEmpty) {
        return (
          <div className='space-y-2'>
            {versionsWarning && <p className='text-xs text-amber-600'>{versionsWarning}</p>}
            <Textarea
              value={content}
              onChange={(event) => updateSectionContent(activeDef, event.target.value)}
              rows={8}
              className='font-mono text-xs'
              data-section={activeDef.id}
              data-wo-field
            />
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => {
                  const table =
                    parseMarkdownTable(content) ||
                    parseKubectlOutputToTable(content) ||
                    parseImageRefListToTable(content);
                  if (!table) {
                    setVersionsWarning('Could not parse this content. Paste kubectl output, a markdown table, or a list of image references (one per line).');
                    return;
                  }
                  setVersionsWarning(null);
                  updateSectionContent(activeDef, serializeMarkdownTable(normalizeVersionsTable(table)));
                }}
              >
                Parse to table
              </Button>
              <Button type='button' size='sm' variant='outline' onClick={() => setVersionsImportOpen(true)}>
                Paste & parse
              </Button>
            </div>
            <p className='text-xs text-muted-foreground'>
              Tip: paste output from <span className='font-mono'>kubectl get deploy -o wide</span> or a plain list of services.
            </p>
          </div>
        );
      }
      const baseTable = parsed || { headers: ['Component', 'Version'], rows: [['', '']] };
      const table = normalizeVersionsTable(baseTable);
      return (
        <div
          className='space-y-2'
          onPaste={(event) => {
            const text = event.clipboardData.getData('text/plain');
            if (!text) return;
            const parsedTable =
              parseMarkdownTable(text) ||
              parseKubectlOutputToTable(text) ||
              parseImageRefListToTable(text);
            if (parsedTable) {
              event.preventDefault();
              setVersionsWarning(null);
              updateSectionContent(activeDef, serializeMarkdownTable(normalizeVersionsTable(parsedTable)));
            } else {
              setVersionsWarning('Paste did not look like a markdown table. Keeping raw text instead.');
              updateSectionContent(activeDef, text);
            }
          }}
        >
          {versionsWarning && <p className='text-xs text-amber-600'>{versionsWarning}</p>}
          <div className='overflow-hidden rounded-md border'>
            <div className='grid grid-cols-[minmax(180px,2fr)_minmax(140px,1fr)_40px] gap-0 border-b bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground'>
              <div>{table.headers[0] || 'Component'}</div>
              <div>{table.headers[1] || 'Version'}</div>
              <div />
            </div>
            <div className='divide-y'>
              {table.rows.map((row, idx) => (
                <div key={idx} className='grid grid-cols-[minmax(180px,2fr)_minmax(140px,1fr)_40px] gap-0 px-3 py-2'>
                  <Input
                    value={row[0] || ''}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const currentVersion = (row[1] || '').trim();
                      const split = !currentVersion ? splitImageRefIntoComponentAndVersion(raw) : null;
                      const nextComponent = split?.component ?? raw;
                      const nextVersion = split?.version ?? (row[1] || '');
                      const next = table.rows.map((r, i) => (i === idx ? [nextComponent, nextVersion] : r));
                      updateSectionContent(activeDef, serializeMarkdownTable({ ...table, rows: next }));
                    }}
                    placeholder='Service / repo'
                    className='h-8 text-xs'
                    data-section={activeDef.id}
                    data-wo-field
                  />
                  <Input
                    value={row[1] || ''}
                    onChange={(event) => {
                      const next = table.rows.map((r, i) => (i === idx ? [r[0] || '', event.target.value] : r));
                      updateSectionContent(activeDef, serializeMarkdownTable({ ...table, rows: next }));
                    }}
                    placeholder='Version'
                    className='h-8 text-xs'
                    data-section={activeDef.id}
                    data-wo-field
                  />
                  <div className='flex items-center justify-end'>
                    <Button
                      type='button'
                      size='icon'
                      variant='ghost'
                      className='h-8 w-8'
                      onClick={() => {
                        const next = table.rows.filter((_, i) => i !== idx);
                        updateSectionContent(activeDef, serializeMarkdownTable({ ...table, rows: next }));
                      }}
                      aria-label='Delete row'
                    >
                      ×
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => {
              const next = [...table.rows, new Array(table.headers.length).fill('')];
              updateSectionContent(activeDef, serializeMarkdownTable({ ...table, rows: next }));
            }}
          >
            Add row
          </Button>
          <Button type='button' size='sm' variant='outline' onClick={() => setVersionsImportOpen(true)}>
            Paste & parse
          </Button>
        </div>
      );
    }

    if (activeDef.type === 'devlog') {
      const content = readSection(bodyMarkdown, activeDef.heading);
      const lines = content.split('\n');
      const entryIndices = lines
        .map((line, idx) => (line.trim().startsWith('- ') ? idx : -1))
        .filter((idx) => idx >= 0);
      const entries = entryIndices.map((idx) => {
        const raw = lines[idx].replace(/^- /, '').trim();
        const match = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+\(([^)]+)\):\s*(.*)$/.exec(raw);
        return {
          raw,
          timestamp: match?.[1],
          author: match?.[2],
          message: match?.[3] ?? raw,
        };
      });
      const lastEntry = entries[entries.length - 1];
      const isAdmin = hasRole('admin') || hasRole('super_admin');
      const isAuthor = lastEntry?.author && lastEntry.author === (user?.email || user?.full_name);
      const lastTimestamp = lastEntry?.timestamp ? new Date(lastEntry.timestamp.replace(' ', 'T')) : null;
      const withinWindow = lastTimestamp ? Date.now() - lastTimestamp.getTime() < 10 * 60 * 1000 : false;
      const allowEdit = !!lastEntry && (isAdmin || (isAuthor && withinWindow));

      const updateLastEntry = (message: string) => {
        if (!lastEntry) return;
        const nextLines = [...lines];
        const idx = entryIndices[entryIndices.length - 1];
        const timestamp = lastEntry.timestamp || new Date().toISOString().slice(0, 16).replace('T', ' ');
        const author = lastEntry.author || user?.email || user?.full_name || 'user';
        nextLines[idx] = `- ${timestamp} (${author}): ${message}`;
        updateSectionContent(activeDef, nextLines.join('\n'));
      };

      return (
        <div className='space-y-3'>
          <div className='space-y-2 rounded-md border bg-muted/10 p-3'>
            {entries.length === 0 ? (
              <p className='text-xs text-muted-foreground'>No dev log entries yet.</p>
            ) : (
              entries.map((entry, idx) => (
                <div key={idx} className='rounded-md border bg-white px-3 py-2 text-xs'>
                  <div className='flex items-center justify-between text-[11px] text-muted-foreground'>
                    <span>{entry.timestamp || 'Entry'}</span>
                    <span>{entry.author || 'Unknown'}</span>
                  </div>
                  <div className='mt-1 text-sm'>{renderAutoLinks(entry.message)}</div>
                </div>
              ))
            )}
          </div>
          {allowEdit && !devLogEditing ? (
            <Button type='button' size='sm' variant='outline' onClick={() => setDevLogEditing(true)}>
              Edit last entry
            </Button>
          ) : null}
          {devLogEditing && lastEntry ? (
            <div className='space-y-2'>
              <Textarea
                value={devLogDraft || lastEntry.message}
                onChange={(event) => setDevLogDraft(event.target.value)}
                rows={4}
                className='text-sm'
                data-section={activeDef.id}
                data-wo-field
              />
              <div className='flex gap-2'>
                <Button
                  type='button'
                  size='sm'
                  onClick={() => {
                    updateLastEntry(devLogDraft || lastEntry.message);
                    setDevLogEditing(false);
                    setDevLogDraft('');
                  }}
                >
                  Save edit
                </Button>
                <Button type='button' size='sm' variant='ghost' onClick={() => setDevLogEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          <div className='space-y-2'>
            <Textarea
              value={devLogDraft}
              onChange={(event) => setDevLogDraft(event.target.value)}
              placeholder='Write a new dev log entry...'
              rows={3}
              className='text-sm'
              data-section={activeDef.id}
              data-wo-field
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  addDevLogEntry();
                }
              }}
            />
            <Button
              type='button'
              size='sm'
              onClick={() => addDevLogEntry()}
            >
              Add entry
            </Button>
          </div>
        </div>
      );
    }

    return (
      <SmartTextarea
        value={readSection(bodyMarkdown, activeDef.heading)}
        onChange={(next) => updateSectionContent(activeDef, next)}
        placeholder={activeDef.template}
        rows={8}
        dataSection={activeDef.id}
      />
    );
  };

  const actionGroups = useMemo(() => {
    const filtered = KEYBINDING_ACTIONS.map((action) => ({
      ...action,
      bindings: keybindings.bindings[action.id] || [],
    })).filter((action) => {
      if (!shortcutSearch.trim()) return true;
      const query = shortcutSearch.toLowerCase();
      return (
        action.label.toLowerCase().includes(query) ||
        action.id.toLowerCase().includes(query) ||
        action.bindings.some((binding) => binding.toLowerCase().includes(query))
      );
    });
    const grouped: Record<string, typeof filtered> = {};
    filtered.forEach((action) => {
      grouped[action.category] = grouped[action.category] || [];
      grouped[action.category].push(action);
    });
    return grouped;
  }, [keybindings, shortcutSearch]);

  const paletteActions = useMemo(() => {
    const query = paletteSearch.trim().toLowerCase();
    return KEYBINDING_ACTIONS.map((action) => ({
      ...action,
      bindings: keybindings.bindings[action.id] || [],
    })).filter((action) => {
      if (!query) return true;
      return (
        action.label.toLowerCase().includes(query) ||
        action.id.toLowerCase().includes(query) ||
        action.bindings.some((binding) => binding.toLowerCase().includes(query))
      );
    });
  }, [keybindings, paletteSearch]);

  const overlayBinding = keybindings.bindings['content.help.overlay.toggle']?.[0] || 'Mod+/';

  return (
    <div ref={containerRef} className='flex h-full min-h-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <Button type='button' variant='outline' size='sm' className='lg:hidden' onClick={() => setSectionDrawerOpen(true)}>
            <Layers className='mr-2 h-4 w-4' />
            Sections
          </Button>
          {saveLabel ? <span className='text-xs text-muted-foreground'>{saveLabel}</span> : null}
          {localDraftLabel ? <span className='text-xs text-muted-foreground'>{localDraftLabel}</span> : null}
        </div>
        <div className='flex items-center gap-2'>
          <Button type='button' size='sm' variant='outline' onClick={() => setPaletteOpen(true)}>
            <Search className='mr-2 h-4 w-4' />
            Commands
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type='button' size='sm' variant='outline'>
                <HelpCircle className='mr-2 h-4 w-4' />
                ?
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className='w-80 p-3'>
              <div className='space-y-2'>
                <p className='text-sm font-semibold'>Shortcuts</p>
                <div className='space-y-1 text-xs text-muted-foreground'>
                  {Object.values(actionGroups)
                    .flat()
                    .filter((action) => action.bindings.length > 0)
                    .slice(0, 8)
                    .map((action) => (
                      <div key={action.id} className='flex items-center justify-between gap-2'>
                        <span>{action.label}</span>
                        <span className='rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
                          {comboToDisplay(action.bindings[0])}
                        </span>
                      </div>
                    ))}
                </div>
                <div className='rounded-md border bg-muted/20 p-2 text-[11px] text-muted-foreground'>
                  Open Shortcut Overlay ({comboToDisplay(overlayBinding)})
                </div>
                <p className='text-xs font-medium'>Templates</p>
                <div className='space-y-1 text-xs text-muted-foreground'>
                  {SECTION_DEFINITIONS.map((section) => (
                    <button
                      key={section.id}
                      type='button'
                      className='flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-muted/40'
                      onClick={() => insertTemplateFor(section.id)}
                    >
                      <span>{section.title}</span>
                      <ListPlus className='h-3 w-3 text-muted-foreground' />
                    </button>
                  ))}
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type='button' size='sm' variant='outline' onClick={() => setShortcutOverlayOpen(true)}>
            <FileText className='mr-2 h-4 w-4' />
            Shortcuts
          </Button>
          <Button type='button' size='sm' variant='outline' onClick={() => setPreviewOpen((prev) => !prev)}>
            <PanelRightOpen className='mr-2 h-4 w-4' />
            Preview
          </Button>
        </div>
      </div>

      <div className='flex min-h-0 flex-1 gap-4'>
        <aside className='hidden w-72 flex-col rounded-lg border bg-white p-3 lg:flex'>{renderSectionList}</aside>

        <div className='flex min-h-0 flex-1 flex-col rounded-lg border bg-white'>
          <div className='flex items-center justify-between border-b px-4 py-3'>
            <div>
              <p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>Editing</p>
              <p className='text-base font-semibold'>{activeDef?.title}</p>
              <p className='text-xs text-muted-foreground'>{activeDef?.status.reason}</p>
            </div>
            <div className='flex items-center gap-2'>
              <Button type='button' size='sm' variant='outline' onClick={insertTemplate}>
                <ListPlus className='mr-2 h-4 w-4' />
                Insert template
              </Button>
              <ConfirmDialog
                title='Clear section?'
                description='This will remove all content from the current section.'
                confirmText='Clear'
                onConfirm={clearSection}
                trigger={
                  <Button type='button' size='sm' variant='ghost'>
                    Clear
                  </Button>
                }
              />
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={() => handleAction('content.copySectionMarkdown')}
              >
                <Copy className='mr-2 h-4 w-4' />
                Copy
              </Button>
            </div>
          </div>

          <div ref={editorRef} className='flex-1 overflow-auto p-4'>
            {renderActiveEditor()}
          </div>
        </div>
      </div>

      <Sheet open={sectionDrawerOpen} onOpenChange={setSectionDrawerOpen}>
        <SheetTrigger asChild>
          <span />
        </SheetTrigger>
        <SheetContent side='left' className='flex flex-col'>
          <SheetHeader>
            <SheetTitle>Sections</SheetTitle>
          </SheetHeader>
          <div className='mt-4 flex-1'>{renderSectionList}</div>
        </SheetContent>
      </Sheet>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetTrigger asChild>
          <span />
        </SheetTrigger>
        <SheetContent side='right' className='flex flex-col'>
          <SheetHeader>
            <SheetTitle>Live preview</SheetTitle>
          </SheetHeader>
          <ScrollArea className='mt-4 flex-1 pr-2'>
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm'>{activeDef?.title}</CardTitle>
              </CardHeader>
              <CardContent className='text-sm'>
                {activeDef ? (
                  <MarkdownRenderer
                    content={`## ${activeDef.heading}\n\n${readSection(bodyMarkdown, activeDef.heading) || ''}`}
                  />
                ) : (
                  'No content yet.'
                )}
              </CardContent>
            </Card>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <DialogPrimitive.Root open={versionsImportOpen} onOpenChange={setVersionsImportOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-slate-950/40' />
          <DialogPrimitive.Content className='fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-6 shadow-soft'>
            <DialogPrimitive.Title className='text-lg font-semibold'>Paste & parse versions</DialogPrimitive.Title>
            <DialogPrimitive.Description className='mt-2 text-sm text-muted-foreground'>
              Paste kubectl output (<span className='font-mono'>kubectl get deploy -o wide</span>), a markdown table, or a list of image references (one per line, e.g. <span className='font-mono'>registry.company.com/platform/localization:1.8.10</span>).
            </DialogPrimitive.Description>
            <div className='mt-4 space-y-3'>
              <Textarea
                value={versionsImportText}
                onChange={(event) => setVersionsImportText(event.target.value)}
                rows={8}
                className='font-mono text-xs'
                placeholder={`kubectl output:\nNAME  READY  ...  IMAGES\nmy-service  1/1  ...  registry/my-service:1.2.3\n\nor image list (one per line):\nregistry.company.com/platform/localization:1.8.10\nregistry.company.com/platform/shell-ui:15.1.19\nregistry.company.com/platform/tenant-management:0.2.7`}
                autoFocus
              />
              {versionsImportError ? <p className='text-sm text-destructive'>{versionsImportError}</p> : null}
              <div className='flex justify-end gap-2'>
                <Button type='button' variant='ghost' onClick={() => setVersionsImportOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type='button'
                  onClick={() => {
                    if (!activeDef || activeDef.id !== 'versions') {
                      setVersionsImportError('Open the “Versions used” section first.');
                      return;
                    }
                    const table =
                      parseMarkdownTable(versionsImportText) ||
                      parseKubectlOutputToTable(versionsImportText) ||
                      parseImageRefListToTable(versionsImportText);
                    if (!table) {
                      setVersionsImportError('Could not parse this input. Paste kubectl output, a markdown table, or a list of image references (one per line).');
                      return;
                    }
                    setVersionsWarning(null);
                    updateSectionContent(activeDef, serializeMarkdownTable(normalizeVersionsTable(table)));
                    setVersionsImportOpen(false);
                  }}
                >
                  Parse
                </Button>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <DialogPrimitive.Root open={shortcutOverlayOpen} onOpenChange={setShortcutOverlayOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-slate-950/40' />
          <DialogPrimitive.Content className='fixed inset-0 z-50 flex flex-col bg-white p-6 shadow-soft'>
            <DialogPrimitive.Title className='text-lg font-semibold'>Shortcut help</DialogPrimitive.Title>
            <div className='mt-4 flex min-h-0 flex-1 flex-col gap-4'>
              <Input
                placeholder='Search actions…'
                className='h-9'
                value={shortcutSearch}
                onChange={(event) => setShortcutSearch(event.target.value)}
                autoFocus
              />
              <div className='min-h-0 flex-1 space-y-4 overflow-auto pr-2'>
                {Object.entries(actionGroups).map(([group, actions]) => (
                  <div key={group} className='space-y-2'>
                    <p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>{group}</p>
                    <div className='space-y-2'>
                      {actions.map((action) => (
                        <div key={action.id} className='flex items-center justify-between rounded-md border px-3 py-2 text-sm'>
                          <div>
                            <p className='font-medium'>{action.label}</p>
                            {action.description ? <p className='text-xs text-muted-foreground'>{action.description}</p> : null}
                          </div>
                          <div className='flex items-center gap-2'>
                            {action.bindings.length > 0 ? (
                              action.bindings.map((binding) => (
                                <span key={binding} className='rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground'>
                                  {comboToDisplay(binding)}
                                </span>
                              ))
                            ) : (
                              <span className='text-[10px] text-muted-foreground'>Unbound</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className='flex justify-end'>
                <Button type='button' variant='outline' onClick={() => setShortcutOverlayOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <DialogPrimitive.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-slate-950/40' />
          <DialogPrimitive.Content className='fixed left-1/2 top-[20%] z-50 w-[92vw] max-w-xl -translate-x-1/2 rounded-lg border bg-white p-4 shadow-soft'>
            <DialogPrimitive.Title className='text-base font-semibold'>Command palette</DialogPrimitive.Title>
            <div className='mt-3 space-y-3'>
              <Input
                placeholder='Type a command…'
                className='h-9'
                value={paletteSearch}
                onChange={(event) => setPaletteSearch(event.target.value)}
                autoFocus
              />
              <div className='max-h-[300px] space-y-2 overflow-auto pr-2'>
                {paletteActions.map((action) => (
                  <button
                    key={action.id}
                    type='button'
                    className='flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/40'
                    onClick={() => {
                      handleAction(action.id);
                      setPaletteOpen(false);
                    }}
                  >
                    <span>{action.label}</span>
                    <span className='text-[10px] text-muted-foreground'>
                      {(keybindings.bindings[action.id] || []).map((binding) => comboToDisplay(binding)).join(', ') ||
                        'Unbound'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
