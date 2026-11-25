// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { LucideIcon } from 'lucide-react';

interface MobileMenuSwitchProps {
  icon: LucideIcon;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}

export function MobileMenuSwitch({ icon: Icon, label, checked, disabled, onChange }: MobileMenuSwitchProps) {
  return (
    <label className="tool-row">
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      <input className="ui-switch" type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}
