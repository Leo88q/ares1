import { memo } from 'react';
import { t } from '../../i18n'

import { motion } from 'framer-motion';
import { ConsolePanel } from './panels';
import { IconWrench } from './icons';

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
   whileTap={task.done ? undefined : { scale: 0.98 }}
   style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    border: 'none',
    background: task.done ? 'rgba(124,255,107,0.08)' : 'rgba(0,0,0,0.3)',
    cursor: task.done ? 'default' : 'pointer',
    textAlign: 'left',
   }}
  >
   <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <IconWrench
     size={14}
     accent={task.done ? 'var(--ares-bio-green, #7CFF6B)' : 'var(--ares-hud-amber, #FFB347)'}
    />
    <span
     style={{
      fontSize: 12,
      color: task.done ? 'var(--ares-bio-green, #7CFF6B)' : 'rgba(255,179,71,0.9)',
      textDecoration: task.done ? 'line-through' : undefined,
     }}
    >
     {task.title}
    </span>
   </div>
   {task.rewardLabel ? (
    <span className="ares-mono" style={{ fontSize: 10, color: 'var(--ares-hud-amber, #FFB347)' }}>
     {task.rewardLabel}
    </span>
   ) : null}
  </motion.button>
 );
});

export const ShiftTasksList = memo(function ShiftTasksList({
 tasks,
 onComplete,
}: ShiftTasksListProps): JSX.Element {
 return (
  <ConsolePanel title={t("ЗАДАЧИ СМЕНЫ")} tone="neutral">
   <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    {tasks.map((task) => (
     <ShiftTaskRow key={task.id} task={task} onComplete={onComplete} />
    ))}
   </div>
  </ConsolePanel>
 );
});
