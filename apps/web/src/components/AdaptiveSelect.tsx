// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { dropdownPosition } from '../lib/dropdownPosition.ts';

interface Option { value: string; label: string; disabled?: boolean }
interface Props {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
  tone?: 'remote';
}

export function AdaptiveSelect({ label, value, options, onChange, disabled, testId, tone }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<ReturnType<typeof dropdownPosition> | null>(null);
  const selected = options.find(option => option.value === value);
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const show = () => {
    if (disabled) return;
    if (open) { menu.current?.focus({ preventScroll: true }); return; }
    const current = options.findIndex(option => option.value === value && !option.disabled);
    setActive(current >= 0 ? current : Math.max(0, options.findIndex(option => !option.disabled)));
    setPosition(null);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || disabled) return;
    const button = trigger.current;
    const list = menu.current;
    if (!button || !list) return;
    const update = () => {
      const anchor = button.getBoundingClientRect();
      const vv = window.visualViewport;
      const stage = button.closest('.stage');
      const css = stage ? getComputedStyle(stage) : null;
      const inset = (edge: string) => Math.max(0, parseFloat(css?.getPropertyValue('--view-' + edge) || '0') || 0) + 8;
      const bounds = {
        left: (vv?.offsetLeft ?? 0) + inset('left'),
        top: (vv?.offsetTop ?? 0) + inset('top'),
        right: (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth) - inset('right'),
        bottom: (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight) - inset('bottom'),
      };
      const toolbar = stage?.querySelector('[data-testid="mobile-dock"]')?.getBoundingClientRect();
      if (toolbar && toolbar.top >= anchor.bottom) bounds.bottom = Math.min(bounds.bottom, toolbar.top - 8);
      setPosition(dropdownPosition(anchor, bounds, Math.max(180, anchor.width), list.scrollHeight + 2));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(button);
    const onScroll = (event: Event) => { if (!list.contains(event.target as Node)) update(); };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [open, disabled, options.length]);

  const positioned = position !== null;
  useLayoutEffect(() => {
    if (open && positioned) menu.current?.focus({ preventScroll: true });
  }, [open, positioned]);

  useLayoutEffect(() => {
    const list = menu.current;
    const item = list?.children[active] as HTMLElement | undefined;
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [active, position?.maxHeight]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  };

  return <>
    <button ref={trigger} type="button" className="adaptive-select-trigger" data-adaptive-select
      data-tone={tone} data-testid={testId} aria-label={label} aria-haspopup="listbox" aria-expanded={open && !disabled}
      aria-controls={open && !disabled ? id : undefined} disabled={disabled}
      onClick={event => { event.preventDefault(); open ? close() : show(); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
      }}>
      <span>{selected?.label ?? value}</span><ChevronDown aria-hidden="true" />
    </button>
    {open && !disabled && createPortal(
      <div className="adaptive-select-layer" data-adaptive-select
        onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) { event.preventDefault(); close(); } }}
        onClick={event => event.stopPropagation()}>
        <div ref={menu} id={id} className="adaptive-select-menu" data-tone={tone} role="listbox" aria-label={label}
          aria-activedescendant={`${id}-${active}`} tabIndex={-1} data-side={position?.side}
          style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : { visibility: 'hidden', width: 180 }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            if (event.key === 'Tab') { close(); return; }
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); return; }
            const available = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
            const index = available.indexOf(active);
            let next: number | undefined;
            if (event.key === 'ArrowDown') next = available[(index + 1) % available.length];
            if (event.key === 'ArrowUp') next = available[(index - 1 + available.length) % available.length];
            if (event.key === 'Home') next = available[0];
            if (event.key === 'End') next = available.at(-1);
            if (next !== undefined) { event.preventDefault(); setActive(next); }
          }}>
          {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option"
            aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
            className={index === active ? 'active' : undefined}
            onPointerMove={event => { if (event.pointerType === 'mouse' && !option.disabled) setActive(index); }} onClick={() => choose(index)}>
            <span>{option.label}</span>{option.value === value && <Check aria-hidden="true" />}
          </div>)}
        </div>
      </div>, document.fullscreenElement ?? document.body,
    )}
  </>;
}
