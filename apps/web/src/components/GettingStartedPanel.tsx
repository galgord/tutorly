import { MessageSquare, Share2, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, CardHeader } from './ui';

interface Props {
  onAddStudent: () => void;
}

/**
 * First-run getting-started panel shown on the Dashboard when the tutor has no
 * students. Replaces the thin empty state with a 3-step explanation of the
 * Tutorly loop (add student → write feedback → share game link).
 */
export function GettingStartedPanel({ onAddStudent }: Props) {
  const { t } = useTranslation();

  const steps: { Icon: LucideIcon; title: string; body: string }[] = [
    {
      Icon: UserPlus,
      title: t('gettingStarted.steps.addStudent.title'),
      body: t('gettingStarted.steps.addStudent.body'),
    },
    {
      Icon: MessageSquare,
      title: t('gettingStarted.steps.feedback.title'),
      body: t('gettingStarted.steps.feedback.body'),
    },
    {
      Icon: Share2,
      title: t('gettingStarted.steps.share.title'),
      body: t('gettingStarted.steps.share.body'),
    },
  ];

  return (
    <Card data-testid="dashboard-getting-started">
      <CardHeader>
        <div>
          <h2 className="text-lg font-semibold text-ink">{t('gettingStarted.title')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{t('gettingStarted.subtitle')}</p>
        </div>
        <Button onClick={onAddStudent} icon={<UserPlus size={16} aria-hidden />} data-testid="getting-started-add-student">
          {t('students.add.button')}
        </Button>
      </CardHeader>
      <CardBody>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-2 rounded-lg border border-line bg-surface-muted p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                  {index + 1}
                </span>
                <step.Icon size={18} aria-hidden className="text-brand-600" />
              </div>
              <p className="text-sm font-semibold text-ink">{step.title}</p>
              <p className="text-sm text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
