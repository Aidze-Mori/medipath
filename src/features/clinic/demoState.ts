import type { Analysis, DocumentRecord } from '../../domain';

export type NotificationReason = 'result_ready' | 'unbooked' | 'return' | 'clarify' | 'call';
export type NotificationChannel = 'push' | 'sms';
export const NOTIFICATION_REASONS: Record<NotificationReason, { label: string; title: string; body: string }> = {
  result_ready: { label: 'Результат готов', title: 'Результат исследования готов', body: 'Посмотреть результат в личном кабинете клиники.' },
  unbooked: { label: 'Есть рекомендация без записи', title: 'Ваш план посещений', body: 'Вы можете вернуться к рекомендациям и выбрать удобное время.' },
  clarify: { label: 'Уточнить детали', title: 'Клиника уточняет детали', body: 'Откройте личный кабинет или свяжитесь с администратором в удобное время.' },
  call: { label: 'Попросить перезвонить', title: 'Свяжитесь с клиникой', body: 'Администратор просит связаться с клиникой, чтобы согласовать организационные детали.' },
  return: { label: 'Вернуться в личный кабинет', title: 'Будем рады видеть вас снова', body: 'Откройте личный кабинет клиники, когда вам будет удобно.' },
};
export interface DemoNotification {
  id: string;
  fixtureId: string;
  revision: number;
  channel: NotificationChannel;
  reason: NotificationReason;
  createdAt: string;
  openedAt: string | null;
}

export function createDemoNotification(
  notifications: readonly DemoNotification[],
  input: Pick<DemoNotification, 'fixtureId' | 'revision' | 'channel' | 'reason'>,
): DemoNotification[] {
  const existing = notifications.find((item) => item.fixtureId === input.fixtureId
    && item.revision === input.revision && item.channel === input.channel && item.reason === input.reason);
  return existing ? [...notifications] : [...notifications, {
    ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), openedAt: null,
  }];
}

export type StaffRole = 'administrator' | 'doctor';
export type FeedbackCategory = 'text' | 'source' | 'route' | 'other';
export type FeedbackStatus = 'new' | 'reviewing' | 'closed';
export const FEEDBACK_CATEGORIES: Record<FeedbackCategory, string> = {
  text: 'Текст пояснения', source: 'Источник', route: 'Маршрут', other: 'Другое',
};
export const FEEDBACK_STATUSES: Record<FeedbackStatus, string> = {
  new: 'Новое', reviewing: 'На рассмотрении', closed: 'Закрыто',
};
export interface StaffFeedback {
  id: string;
  fixtureId: string;
  documentId: string;
  documentRevision: number;
  analysisId: string;
  contextVersion: string;
  corpusVersion: string;
  model: string;
  sourceIds: string[];
  fragment: string;
  role: StaffRole;
  category: FeedbackCategory;
  comment: string;
  createdAt: string;
  status: FeedbackStatus;
  resolution: string;
}

export function createStaffFeedback(input: {
  document: DocumentRecord;
  analysis: Analysis;
  role: StaffRole;
  category: FeedbackCategory;
  comment: string;
  fragment: string;
}): StaffFeedback {
  if (!input.document.fixtureId || input.analysis.documentId !== input.document.id
    || input.analysis.documentRevision !== input.document.revision) {
    throw new Error('Откройте актуальное пояснение учебного результата.');
  }
  if (input.comment.trim().length < 5 || input.comment.trim().length > 500) {
    throw new Error('Добавьте комментарий от 5 до 500 символов.');
  }
  const claim = input.analysis.claims.find((item) => item.id === input.fragment);
  if (input.fragment && !claim) throw new Error('Выбранный фрагмент больше недоступен.');
  return {
    id: crypto.randomUUID(), fixtureId: input.document.fixtureId,
    documentId: input.document.id, documentRevision: input.document.revision,
    analysisId: `${input.document.id}:${input.document.revision}:${input.analysis.corpusVersion}`,
    contextVersion: 'Только выбранный документ', corpusVersion: input.analysis.corpusVersion,
    model: 'Локальные правила; LLM не вызывалась в рабочем месте клиники',
    sourceIds: [...new Set((claim ? [claim] : input.analysis.claims).flatMap((item) => item.sourceIds))],
    fragment: claim?.text ?? '', role: input.role, category: input.category,
    comment: input.comment.trim(), createdAt: new Date().toISOString(), status: 'new', resolution: '',
  };
}

export function updateFeedbackStatus(feedback: StaffFeedback, status: FeedbackStatus, resolution = ''): StaffFeedback {
  if (status === 'closed' && (resolution.trim().length < 5 || resolution.trim().length > 500)) {
    throw new Error('Для закрытия укажите результат разбора от 5 до 500 символов.');
  }
  return { ...feedback, status, resolution: status === 'closed' ? resolution.trim() : feedback.resolution };
}
