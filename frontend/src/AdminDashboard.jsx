import React from 'react';
import { useConfirm } from './hooks/useConfirm';

export default function AdminDashboard({ users = [], onBan = () => {}, onUnban = () => {} }) {
  const { confirm, confirmDialog } = useConfirm();

  async function handleBan(u) {
    const ok = await confirm({
      title: `Ban ${u.name}?`,
      description: 'They will lose access immediately.',
      confirmLabel: 'Ban',
      destructive: true,
    });
    if (ok) onBan(u);
  }

  return (
    <div>
      {users.map((u) =>
        u.isBanned ? (
          <button key={u.id} onClick={() => onUnban(u)}>Unban</button>
        ) : (
          <button key={u.id} onClick={() => handleBan(u)}>Ban</button>
        )
      )}
      {confirmDialog}
    </div>
  );
}
