'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  CheckSquare,
  ChevronRight,
  ClipboardList,
  FileText,
  GitBranch,
  Globe,
  LayoutDashboard,
  Package,
  Search,
  Settings,
  Zap,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = { number: number; title: string; description: string };
type Section = {
  id: string;
  icon: React.ElementType;
  iconColor: string;
  title: string;
  subtitle: string;
  description: string;
  steps?: Step[];
  tips?: string[];
  link?: { href: string; label: string };
};

// ── Content ────────────────────────────────────────────────────────────────────

const SECTIONS: Section[] = [
  {
    id: 'overview',
    icon: BookOpen,
    iconColor: 'text-blue-600',
    title: 'What is the Release Management Module?',
    subtitle: 'The big picture',
    description:
      'The Release Management Module helps your team plan, prepare, and safely deploy software updates to your Open Banking Platform — across multiple data centers and customer environments. Think of it as a control tower: everything from planning a new release to deploying it on production is tracked in one place.',
    tips: [
      'A Release is a collection of Work Orders — things your developers worked on.',
      'Work Orders link to Release Notes, which describe exactly what changed and how to deploy it.',
      'When you are ready to go live, the system auto-generates a complete deployment checklist from all the Release Notes.',
      'You can deploy to multiple data centers (DC1, DC2, DR, etc.) independently and track progress per environment.',
    ],
  },
  {
    id: 'work-orders',
    icon: ClipboardList,
    iconColor: 'text-violet-600',
    title: 'Work Orders',
    subtitle: 'What developers deliver',
    description:
      'A Work Order (WO) represents a unit of work — a feature, bug fix, or improvement. Each WO lists the services/components that were changed, and links to the Release Notes document that explains how to deploy those changes.',
    steps: [
      { number: 1, title: 'Create a Work Order', description: 'Go to Work Orders and click "New". Fill in the title, type (feature, bugfix, etc.), affected services, and the Git repository for each service.' },
      { number: 2, title: 'Link Release Notes', description: 'On each service row in the WO, click "Link RN" to attach an internal Release Notes document. This is the step-by-step guide for the deployer.' },
      { number: 3, title: 'Save and sync', description: 'The WO is stored as a markdown file in your GitHub repository. The system syncs it automatically.' },
    ],
    tips: [
      'Save the WO first before linking Release Notes — the picker appears after the WO has been saved once.',
      'A WO can touch many services across different repositories.',
    ],
    link: { href: '/work-orders', label: 'Go to Work Orders' },
  },
  {
    id: 'release-notes',
    icon: FileText,
    iconColor: 'text-emerald-600',
    title: 'Release Notes',
    subtitle: 'The technical deployment recipe',
    description:
      'Release Notes are structured documents (not free text!) that describe what changed in a service or configuration, and exactly how to deploy it. Every developer can write them; a senior can approve them.',
    steps: [
      { number: 1, title: 'Create Release Notes', description: 'Go to Release Notes, click "New". Select the service, the tag/version (e.g. 2.4.1), and the component type (service or configuration).' },
      { number: 2, title: 'Add items', description: 'Add individual items for features, bug fixes, security improvements, or API changes. Each item has a type, title, description, and an optional deployment step.' },
      { number: 3, title: 'Publish or approve', description: 'When ready, change the status from Draft to Published. A senior contributor can approve it for extra confidence.' },
    ],
    tips: [
      'Configuration repos (one branch per bank) use tags like bankId_x.x.x. Service repos use x.x.x.',
      'Multiple developers can co-author the same Release Notes document.',
      'Draft Release Notes are still searchable — they show a draft indicator in search results.',
    ],
    link: { href: '/release-notes', label: 'Go to Release Notes' },
  },
  {
    id: 'platform-releases',
    icon: Package,
    iconColor: 'text-amber-600',
    title: 'Platform Releases',
    subtitle: 'Putting it all together',
    description:
      'A Platform Release (also called a Release Manifest) bundles together multiple Work Orders into a single deployable package. You select the WOs, click "Generate", and the system creates a complete list of services with their latest versions, deployment steps, and a full changelog.',
    steps: [
      { number: 1, title: 'Create a Release', description: 'Go to Platform Releases and click "New Release". Choose the type (Quarterly, Ad-hoc, Security, Bug Fix) and fill in the name.' },
      { number: 2, title: 'Add Work Orders', description: 'On the release detail page, go to the Work Orders tab and add the WOs that belong to this release.' },
      { number: 3, title: 'Generate the manifest', description: 'Click "Generate Release Plan". The system automatically collects all services, resolves version conflicts (always takes the latest semver), aggregates deployment steps, and builds the changelog.' },
      { number: 4, title: 'CAB Approval', description: 'Assign a named approver (CAB) for compliance. Once they approve, the release is ready to deploy.' },
      { number: 5, title: 'Deploy', description: 'Go to the Deployment Runs tab, click "Start Deployment Run", select the target Data Center and environment, and follow the checklist.' },
    ],
    tips: [
      'If the same service appears in multiple WOs, the latest version always wins.',
      'You can deploy the same release to different data centers independently.',
      'An ad-hoc release is for urgent security patches or critical bug fixes between quarterly cycles.',
    ],
    link: { href: '/platform-releases', label: 'Go to Platform Releases' },
  },
  {
    id: 'deployment-checklist',
    icon: CheckSquare,
    iconColor: 'text-rose-600',
    title: 'Deployment Checklist',
    subtitle: 'Step-by-step deployment control',
    description:
      'When you start a Deployment Run for a release, the system breaks the deployment into individual tasks (one per deployment step from all the Release Notes). You can mark items done one by one, or click "Mark All Done" when everything is deployed.',
    steps: [
      { number: 1, title: 'Start a run', description: 'On the release detail page, open the Deployment Runs tab, click "Start Deployment Run", and select the target DC and environment.' },
      { number: 2, title: 'Work through the checklist', description: 'Each group shows the service name with all its deployment steps. Mark items as Done, In Progress, Blocked, or Postponed.' },
      { number: 3, title: 'Handle problems', description: 'If something is blocked, set the status to Blocked and add a note explaining why. The release owner will be notified automatically.' },
      { number: 4, title: 'Complete or re-open', description: 'When all items are done, click "Complete Deployment". If some items were blocked, the run is marked Partial and can be re-opened later.' },
    ],
    tips: [
      'Only one active deployment run is allowed per release + DC + environment at a time.',
      'A completed run can be re-opened to fix blocked items — you do not need to start from scratch.',
      'Blocked item notifications can be configured in Settings → Release Notifications.',
    ],
  },
  {
    id: 'release-calendar',
    icon: Calendar,
    iconColor: 'text-sky-600',
    title: 'Release Calendar',
    subtitle: 'Plan your future releases',
    description:
      'The Release Calendar gives you a visual timeline of all planned, active, and past releases. You can plan the next 4 quarters in advance, adjust dates by editing inline, and insert ad-hoc releases between planned ones.',
    steps: [
      { number: 1, title: 'Plan a release', description: 'Click "+ Plan Release" on the calendar page. Set the name, planned start and end dates, and any planning notes.' },
      { number: 2, title: 'Edit dates', description: 'Click any release in the calendar to open the detail panel on the right. Change dates or notes — changes save automatically.' },
      { number: 3, title: 'Promote to Draft', description: 'When a planned release is ready to start preparation, click "Promote to Draft" in the detail panel.' },
      { number: 4, title: 'Insert ad-hoc', description: 'To add an emergency release between two planned ones, click "Insert Ad-hoc Before" on any release row.' },
    ],
    link: { href: '/release-calendar', label: 'Go to Release Calendar' },
  },
  {
    id: 'release-center',
    icon: LayoutDashboard,
    iconColor: 'text-indigo-600',
    title: 'Release Center',
    subtitle: 'The operations dashboard',
    description:
      'The Release Center is the command view for managers. It shows all active releases, their current phase, what is blocking them, and who needs to act next. You can trigger the next action directly from here without navigating away.',
    tips: [
      '"In Flight" releases are the ones actively being worked on or deployed right now.',
      '"Planned Upcoming" shows the next scheduled releases from the calendar.',
      '"Recently Closed" shows releases that were deployed and closed in the last 30 days.',
      'The page refreshes automatically every 60 seconds.',
    ],
    link: { href: '/release-center', label: 'Go to Release Center' },
  },
  {
    id: 'functionality-search',
    icon: Search,
    iconColor: 'text-teal-600',
    title: 'Functionality Search',
    subtitle: 'Find where a feature is deployed',
    description:
      'Ever wonder if a specific feature is already live on a particular data center? The Functionality Search lets you type any keyword and instantly see which Work Order it belongs to, and on which data centers it is already deployed (or not yet deployed).',
    steps: [
      { number: 1, title: 'Open the search', description: 'Navigate to Release Notes → Search, or use the search shortcut from the Release Management section.' },
      { number: 2, title: 'Type your keyword', description: 'Type any text — the name of a feature, a bug fix description, or a service name. Results update as you type.' },
      { number: 3, title: 'Read the DC matrix', description: 'Each row shows the feature and a column per data center. Green means deployed, amber means partially deployed, grey means not yet.' },
    ],
    tips: [
      'Items from Draft Release Notes appear with a draft indicator icon.',
      'You can filter by component type (service or configuration) and toggle draft visibility.',
    ],
    link: { href: '/release-notes/search', label: 'Open Functionality Search' },
  },
  {
    id: 'data-centers',
    icon: Globe,
    iconColor: 'text-orange-600',
    title: 'Data Centers',
    subtitle: 'Your deployment targets',
    description:
      'Data Centers represent your Kubernetes clusters in different geographic locations. Each tenant configures their own data centers. You reference them when deploying releases and when checking functionality search results.',
    tips: [
      'Go to Settings → Data Centers to add, edit, or remove data centers.',
      'Each release can be deployed to multiple data centers independently.',
      'DR (Disaster Recovery) data centers are tracked separately from primary ones.',
    ],
    link: { href: '/settings', label: 'Manage Data Centers in Settings' },
  },
  {
    id: 'notifications',
    icon: Settings,
    iconColor: 'text-slate-500',
    title: 'Release Notifications',
    subtitle: 'Get notified when deployments hit problems',
    description:
      'You can configure who gets an email when a deployment checklist item is marked as Blocked. This ensures the right people are alerted immediately so nothing sits unnoticed.',
    steps: [
      { number: 1, title: 'Open Settings', description: 'Go to Settings and find the "Release Notifications" section.' },
      { number: 2, title: 'Add recipients', description: 'Type email addresses and press Enter to add them as blocked-item notification recipients.' },
      { number: 3, title: 'Toggle options', description: 'Enable "Notify release owner" and "Notify run starter" to automatically include those people.' },
    ],
    link: { href: '/settings', label: 'Go to Settings' },
  },
  {
    id: 'typical-flow',
    icon: Zap,
    iconColor: 'text-yellow-500',
    title: 'Typical Release Workflow',
    subtitle: 'From start to finish',
    description: 'Here is the end-to-end flow for a standard quarterly release:',
    steps: [
      { number: 1, title: 'Developers create WOs and Release Notes', description: 'Each developer creates a Work Order for their feature or fix, writes the Release Notes (with deployment steps), and links them to the WO service rows.' },
      { number: 2, title: 'Release Manager plans the release', description: 'On the Release Calendar, a planned release is promoted to Draft when preparation starts. Work Orders are added to it.' },
      { number: 3, title: 'Generate the manifest', description: 'The Release Manager clicks "Generate Release Plan" — the system auto-builds the full list of services, versions, and deployment steps.' },
      { number: 4, title: 'CAB approval', description: 'The manifest is sent to the Change Advisory Board (CAB) approver for sign-off.' },
      { number: 5, title: 'Deploy to first DC', description: 'A DevOps engineer opens the Deployment Runs tab, starts a run for the primary DC, and works through the checklist step by step.' },
      { number: 6, title: 'Verify on internal tenant', description: 'After deployment, the internal fictive bank tenant is used to verify the platform is working correctly on the live environment.' },
      { number: 7, title: 'Deploy to remaining DCs', description: 'Once verified, the release is deployed to additional data centers using the same checklist flow. Images are already built, so version prep is skipped.' },
      { number: 8, title: 'Close the release', description: 'After all DCs are deployed and verified, the release owner closes the release.' },
    ],
  },
];

// ── Glossary ───────────────────────────────────────────────────────────────────

const GLOSSARY: Array<{ term: string; definition: string }> = [
  { term: 'WO', definition: 'Work Order — a single unit of work (feature, fix, improvement) done by a developer.' },
  { term: 'Release Notes (RN)', definition: 'A structured document with version, items (features/bugfixes/security), and deployment steps for a specific service or configuration.' },
  { term: 'Platform Release / Manifest', definition: 'A bundle of multiple WOs, aggregated into a deploy-ready document with all services, versions, steps, and changelog.' },
  { term: 'DC', definition: 'Data Center — a Kubernetes cluster in a specific geographic location (e.g. EU-Primary, US-DR).' },
  { term: 'CAB', definition: 'Change Advisory Board — the named approver who signs off on a release before deployment.' },
  { term: 'Deployment Run', definition: 'An active session of deploying a release to a specific DC and environment, with item-by-item progress tracking.' },
  { term: 'SemVer', definition: 'Semantic Versioning — version format x.y.z (e.g. 2.4.1). When there are conflicts, the latest version always wins.' },
  { term: 'Planned', definition: 'A release that exists on the calendar but has not started preparation yet.' },
  { term: 'Draft', definition: 'A release (or release notes) that is being prepared but not yet ready for deployment.' },
  { term: 'In Flight', definition: 'A release that is actively in preparation or being deployed.' },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function ReleaseManagementGuidePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="container mx-auto max-w-4xl px-4 py-5">
          <button
            onClick={() => router.back()}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 flex-shrink-0">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Release Management Guide</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Everything you need to know about planning, preparing, and deploying releases on the Open Banking Platform.
                Written in plain language — no prior release management experience needed.
              </p>
            </div>
          </div>

          {/* Quick nav */}
          <div className="mt-4 flex flex-wrap gap-2">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-900 transition-colors"
              >
                <s.icon className={`h-3 w-3 ${s.iconColor}`} />
                {s.title}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto max-w-4xl px-4 py-8 space-y-10">
        {SECTIONS.map((section) => (
          <div key={section.id} id={section.id} className="scroll-mt-6 rounded-2xl border bg-white shadow-sm overflow-hidden">
            {/* Section header */}
            <div className="flex items-start gap-3 border-b bg-slate-50/60 px-6 py-4">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-white border flex-shrink-0 shadow-sm`}>
                <section.icon className={`h-4.5 w-4.5 ${section.iconColor}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{section.subtitle}</span>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Description */}
              <p className="text-sm text-slate-600 leading-relaxed">{section.description}</p>

              {/* Steps */}
              {section.steps && section.steps.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Step by step</p>
                  <div className="space-y-2">
                    {section.steps.map((step) => (
                      <div key={step.number} className="flex gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500 flex-shrink-0 mt-0.5">
                          {step.number}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{step.title}</p>
                          <p className="text-sm text-slate-500 mt-0.5">{step.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tips */}
              {section.tips && section.tips.length > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Good to know</p>
                  <ul className="space-y-1">
                    {section.tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-amber-400" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Link */}
              {section.link && (
                <div>
                  <Link
                    href={section.link.href}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                  >
                    {section.link.label}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Glossary */}
        <div id="glossary" className="scroll-mt-6 rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="flex items-start gap-3 border-b bg-slate-50/60 px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white border flex-shrink-0 shadow-sm">
              <GitBranch className="h-4.5 w-4.5 text-slate-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">Glossary</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Key terms explained</span>
              </div>
            </div>
          </div>
          <div className="px-6 py-5">
            <dl className="divide-y">
              {GLOSSARY.map((entry) => (
                <div key={entry.term} className="py-3 flex gap-4">
                  <dt className="w-40 flex-shrink-0 text-sm font-semibold text-slate-800">{entry.term}</dt>
                  <dd className="text-sm text-slate-500">{entry.definition}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground pb-8">
          Release Management Module &mdash; Internal Platform Documentation
        </div>
      </div>
    </div>
  );
}
