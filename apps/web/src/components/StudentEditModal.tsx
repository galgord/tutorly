import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Language, StudentResponse } from '@tutor-app/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Bidi } from './Bidi';
import { ConfirmDialog } from './ConfirmDialog';
import { LanguageSelect } from './LanguageSelect';
import { Button, Field, Input, Modal, Textarea } from './ui';

interface Props {
  open: boolean;
  student: StudentResponse;
  onClose: () => void;
  onToast: (message: string) => void;
  onDeleted: () => void;
}

/**
 * Edit a student's profile + manage their share link + delete them. Pulled
 * out of the StudentDetail page body so the page can lead with what the tutor
 * actually came to see (progress, games) instead of an editing surface.
 */
export function StudentEditModal({ open, student, onClose, onToast, onDeleted }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [name, setName] = useState(student.name);
  const [notes, setNotes] = useState(student.notes ?? '');
  const [nativeLanguage, setNativeLanguage] = useState<Language | null>(
    student.nativeLanguage ?? null,
  );
  const [rotateOpen, setRotateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Re-sync the form whenever the modal (re)opens for a fresh student row.
  useEffect(() => {
    if (open) {
      setName(student.name);
      setNotes(student.notes ?? '');
      setNativeLanguage(student.nativeLanguage ?? null);
    }
  }, [open, student]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateStudent(student.id, {
        name: name.trim() || undefined,
        notes: notes.trim() === '' ? null : notes.trim(),
        nativeLanguage,
      }),
    onSuccess: async (updated) => {
      qc.setQueryData(['student', student.id], updated);
      await qc.invalidateQueries({ queryKey: ['students'] });
      onToast(t('students.toast.saved'));
      onClose();
    },
    onError: () => onToast(t('students.toast.saveFailed')),
  });

  const rotateMutation = useMutation({
    mutationFn: () => api.rotateStudentToken(student.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['student', student.id] });
      await qc.invalidateQueries({ queryKey: ['students'] });
      setRotateOpen(false);
      onToast(t('students.toast.tokenRotated'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteStudent(student.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['students'] });
      onDeleted();
    },
  });

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        testId="student-edit-modal"
        title={t('students.detail.editModalTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} data-testid="student-cancel-edit">
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              data-testid="student-save"
            >
              {t('students.detail.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('students.fields.name')}>
            {(fid) => (
              <Input
                id={fid}
                dir="auto"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="student-name-input"
              />
            )}
          </Field>
          <Field label={t('students.fields.notes')}>
            {(fid) => (
              <Textarea
                id={fid}
                dir="auto"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="student-notes-input"
              />
            )}
          </Field>
          <Field
            label={t('students.fields.nativeLanguage')}
            hint={t('students.fields.nativeLanguageHint')}
          >
            {(fid) => (
              <LanguageSelect
                id={fid}
                value={nativeLanguage}
                emptyLabel={t('students.fields.nativeLanguageNone')}
                onChange={setNativeLanguage}
                testId="student-native-language-input"
              />
            )}
          </Field>

          <div className="border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">{t('students.detail.shareTitle')}</h3>
            <p className="mt-1 text-xs text-ink-muted">{t('students.rotate.warning')}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => setRotateOpen(true)}
              data-testid="student-rotate-token"
            >
              {t('students.actions.rotateToken')}
            </Button>
          </div>

          <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
            <h3 className="text-sm font-semibold text-rose-900">{t('students.delete.title')}</h3>
            <p className="mt-1 text-xs text-rose-900">{t('students.delete.warningGeneric')}</p>
            <Button
              variant="danger"
              size="sm"
              className="mt-2"
              onClick={() => setDeleteOpen(true)}
              data-testid="student-delete"
            >
              {t('students.delete.button')}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={rotateOpen}
        testId="rotate-confirm"
        title={t('students.rotate.title')}
        body={t('students.rotate.warning')}
        confirmLabel={t('students.rotate.button')}
        busy={rotateMutation.isPending}
        onConfirm={() => rotateMutation.mutate()}
        onCancel={() => setRotateOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        destructive
        testId="delete-confirm"
        title={t('students.delete.title')}
        body={
          <p>
            {t('students.delete.warning')} <Bidi>{student.name}</Bidi>
          </p>
        }
        expectedConfirmText={student.name}
        confirmInputLabel={t('students.delete.confirmLabel', { name: student.name })}
        confirmLabel={t('students.delete.button')}
        busy={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}
