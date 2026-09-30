import { memo } from 'react';
import { useI18n } from '../../i18n';
import { motion } from 'framer-motion';
import { CheckCircle2, ChevronRight, AlertCircle } from 'lucide-react';
import { ConsolePanel } from './panels';

export interface ShiftTask {
 id: string;
 title: string;
 done: boolean;
 rewardLabel?: string;
}

export interface ShiftTasksListProps {
 tasks: ShiftTask[];
 onComplete: (id: string) => void;
}

interface ShiftTaskRowProps {
 task: ShiftTask;
 onComplete: (id: string) => void;
}

const ShiftTaskRow = memo(function ShiftTaskRow({ task, onComplete }: ShiftTaskRowProps): JSX.Element {
 const handleClick = (): void => {
  if (!task.done) onComplete(task.id);
 };

 return (
  <motion.button
   type="button"
   onClick={handleClick}
   whileTap={task.done ? undefined : { y: 2 }}
   style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    padding: '11px 14px',
    borderRadius: 4,
    border: `1px solid ${task.done ? '#2D3820' : '#5E3D22'}`,
    background: task.done
     ? 'linear-gradient(170deg, #1A2414 0%, #10180B 100%)'
     : 'linear-gradient(170deg, #3A2718 0%, #25170D 100%)',
    cursor: task.done ? 'default' : 'pointer',
    textAlign: 'left',
    boxShadow: task.done ? 'none' : 'inset 0 1px 0 rgba(255,214,160,0.15), 0 3px 0 #120A05, 0 6px 12px rgba(0,0,0,0.5)',
   }}
  >
   <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
    {task.done ? (
     <CheckCircle2 size={16} color="#9FBE7A" style={{ flexShrink: 0 }} />
    ) : (
     <AlertCircle size={16} color="#ED8A45" style={{ flexShrink: 0 }} />
    )}
    <span
     style={{
      fontSize: 13,
      fontWeight: task.done ? 500 : 600,
      color: task.done ? 'var(--pf-text-secondary)' : '#F6F1ED',
      textDecoration: task.done ? 'line-through' : undefined,
      lineHeight: 1.3,
     }}
    >
     {task.title}
    </span>
   </div>

   <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
    {task.rewardLabel ? (
     <span
      className="ares-mono"
      style={{
       fontSize: 10,
       fontWeight: 700,
       color: task.done ? '#9FBE7A' : '#FFC94A',
       background: 'rgba(0,0,0,0.4)',
       padding: '3px 7px',
       borderRadius: 4,
       border: '1px solid rgba(255,255,255,0.06)',
      }}
     >
      {task.rewardLabel}
     </span>
    ) : null}
    {!task.done && <ChevronRight size={14} color="#A8895C" />}
   </div>
  </motion.button>
 );
});

export const ShiftTasksList = memo(function ShiftTasksList({
 tasks,
 onComplete,
}: ShiftTasksListProps): JSX.Element {
 const { t } = useI18n();
 const activeCount = tasks.filter((t) => !t.done).length;

 return (
  <ConsolePanel title={t("ЗАДАЧИ СМЕНЫ")} tone="amber">
   <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div
     style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 4,
      fontSize: 11,
      color: 'var(--ares-dust, #E0A183)',
     }}
     className="ares-mono"
    >
     <span>{t('АКТИВНЫХ ПОРУЧЕНИЙ: {n}', { n: activeCount })}</span>
     <span>{t('ТАП ДЛЯ ПЕРЕХОДА →')}</span>
    </div>
    {tasks.map((task) => (
     <ShiftTaskRow key={task.id} task={task} onComplete={onComplete} />
    ))}
   </div>
  </ConsolePanel>
 );
});
