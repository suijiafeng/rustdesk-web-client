// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Laptop, Monitor, Star, Trash2 } from 'lucide-react';
import { formatPeerId, type SavedDevice } from '../lib/devices';
import { t, type Locale } from '../lib/i18n';

interface PeerListProps {
  locale: Locale;
  devices: SavedDevice[];
  listTab: 'recent' | 'favorites';
  searchQuery: string;
  layout: 'grid' | 'list';
  onSelect: (device: SavedDevice) => void;
  onToggleFavorite: (key: string) => void;
  onRemove: (key: string) => void;
  onRename: (key: string, alias: string) => void;
}

function DeviceActions({
  locale,
  title,
  favorite,
  menuOpen,
  starClass,
  extraClass,
  iconSize,
  onToggleMenu,
  onCloseMenu,
  onToggleFavorite,
  onRename,
  onRemove,
}: {
  locale: Locale;
  title: string;
  favorite: boolean;
  menuOpen: boolean;
  starClass: string;
  extraClass: string;
  iconSize: number;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggleFavorite: () => void;
  onRename: (alias: string) => void;
  onRemove: () => void;
}) {
  const rename = () => {
    onCloseMenu();
    const alias = window.prompt(t(locale, 'renameDevice'), title);
    if (alias) onRename(alias);
  };
  return (
    <div className="rd-peer-actions flex items-center shrink-0">
      <button
        type="button"
        className={starClass}
        aria-label={favorite ? t(locale, 'unfavoriteDevice') : t(locale, 'favoriteDevice')}
        data-tooltip={favorite ? t(locale, 'unfavoriteDevice') : t(locale, 'favoriteDevice')}
        data-tooltip-pos="top"
        aria-pressed={favorite}
        onClick={onToggleFavorite}
      >
        <Star size={iconSize} className={favorite ? 'text-[#f59e0b] fill-[#f59e0b]' : ''} />
      </button>
      <button
        type="button"
        className={extraClass}
        aria-label={t(locale, 'renameDevice')}
        title={t(locale, 'renameDevice')}
        onClick={() => {
          const alias = window.prompt(t(locale, 'renameDevice'), title);
          if (alias) onRename(alias);
        }}
      >
        <span className="text-xs">Aa</span>
      </button>
      <button
        type="button"
        className={`${extraClass} hover:bg-[var(--bad-bg)] hover:text-[var(--bad)]`}
        aria-label={`${t(locale, 'removeDevice')} ${title}`}
        data-tooltip={t(locale, 'removeDevice')}
        data-tooltip-pos="top-end"
        onClick={onRemove}
      >
        <Trash2 size={iconSize - 1} />
      </button>
      <button
        type="button"
        className="rd-peer-more rounded-lg border-0 bg-transparent text-[var(--ink-soft)]"
        data-peer-more=""
        aria-label={t(locale, 'moreActions')}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={(event) => {
          event.stopPropagation();
          onToggleMenu();
        }}
      >
        …
      </button>
      {menuOpen ? (
        <div className="rd-peer-menu" data-peer-menu="" role="menu" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={rename}>{t(locale, 'renameDevice')}</button>
          <button type="button" role="menuitem" onClick={() => { onCloseMenu(); onRemove(); }}>{t(locale, 'removeDevice')}</button>
        </div>
      ) : null}
    </div>
  );
}

function formatPrimaryId(device: SavedDevice): string {
  return device.mode === 'id'
    ? formatPeerId(device.peerId ?? '')
    : `${device.host ?? ''}:${device.port ?? '21118'}`;
}

export function PeerList({
  locale,
  devices,
  listTab,
  searchQuery,
  layout,
  onSelect,
  onToggleFavorite,
  onRemove,
  onRename,
}: PeerListProps) {
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const pressRef = useRef<{ timer: number; fired: boolean } | null>(null);

  useEffect(() => {
    if (!menuKey) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setMenuKey(null);
        return;
      }
      if (target.closest('[data-peer-menu], [data-peer-more]')) return;
      setMenuKey(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuKey]);

  const startPress = (key: string, event: ReactPointerEvent) => {
    if (event.pointerType === 'mouse') return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-peer-menu], [data-peer-more]')) return;
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    const state = { timer: 0, fired: false };
    state.timer = window.setTimeout(() => {
      state.fired = true;
      setMenuKey(key);
    }, 500);
    pressRef.current = state;
  };

  const endPress = () => {
    if (!pressRef.current) return;
    window.clearTimeout(pressRef.current.timer);
  };

  const suppressSelect = (event: ReactMouseEvent) => {
    if (!pressRef.current?.fired) return;
    pressRef.current.fired = false;
    event.preventDefault();
    event.stopPropagation();
  };

  if (devices.length === 0) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center text-center py-16 px-6"
        data-testid="device-list"
        data-empty="true"
      >
        <div className="rd-empty-icon">
          {listTab === 'favorites' ? <Star size={22} /> : <Monitor size={22} />}
        </div>
        <p
          className="m-0 text-sm text-[var(--ink-soft)] max-w-[300px] leading-relaxed"
          data-testid="device-list-empty"
        >
          {searchQuery.trim()
            ? t(locale, 'noMatchingDevices')
            : listTab === 'favorites'
              ? t(locale, 'noFavorites')
              : t(locale, 'noRecentSessions')}
        </p>
      </div>
    );
  }

  if (layout === 'grid') {
    return (
      <ul
        className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5"
        data-testid="device-list"
      >
        {devices.map((device) => {
          const primaryId = formatPrimaryId(device);
          const title = device.hostname || primaryId;
          const metaParts = [
            device.platform || null,
            device.mode === 'id' ? t(locale, 'modeId') : t(locale, 'modeDirect'),
          ].filter(Boolean);

          return (
            <li
              key={device.key}
              className="rd-device-card"
              onPointerDown={(event) => startPress(device.key, event)}
              onPointerUp={endPress}
              onPointerCancel={endPress}
              onClickCapture={suppressSelect}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="flex items-start gap-2.5">
                <button
                  type="button"
                  className="flex-1 min-w-0 flex items-center gap-3 text-left bg-transparent border-0 p-0"
                  onClick={() => onSelect(device)}
                >
                  <div className="w-10 h-10 rounded-xl bg-[var(--rd-icon-tile-bg)] text-[var(--accent)] flex items-center justify-center shrink-0">
                    {/mac/i.test(device.platform) ? <Laptop size={19} /> : <Monitor size={19} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="rd-peer-name text-[14px] font-semibold text-[var(--ink)] truncate" title={title}>
                      {title}
                    </div>
                    <div className="text-xs font-mono-tabular font-medium text-[var(--rd-id-ink)] truncate mt-0.5">
                      {primaryId}
                    </div>
                  </div>
                </button>

                <DeviceActions
                  locale={locale}
                  title={title}
                  favorite={device.favorite}
                  menuOpen={menuKey === device.key}
                  iconSize={15}
                  starClass="w-8 h-8 inline-flex items-center justify-center rounded-lg border-0 bg-transparent text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)] hover:text-[#f59e0b]"
                  extraClass="rd-peer-extra w-8 h-8 inline-flex items-center justify-center rounded-lg border-0 bg-transparent text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)]"
                  onToggleMenu={() => setMenuKey((current) => current === device.key ? null : device.key)}
                  onCloseMenu={() => setMenuKey(null)}
                  onToggleFavorite={() => onToggleFavorite(device.key)}
                  onRename={(alias) => onRename(device.key, alias)}
                  onRemove={() => onRemove(device.key)}
                />
              </div>

              <button
                type="button"
                className="w-full text-left bg-transparent border-0 p-0 pt-2.5 mt-2.5 border-t border-[var(--rd-divider)] text-xs text-[var(--ink-soft)] truncate"
                onClick={() => onSelect(device)}
              >
                {metaParts.join(' · ')}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="list-none m-0 p-0 rd-peer-list-panel" data-testid="device-list">
      {devices.map((device) => {
        const primaryId = formatPrimaryId(device);
        const title = device.hostname || primaryId;
        const metaParts = [
          device.platform || null,
          device.mode === 'id' ? t(locale, 'modeId') : t(locale, 'modeDirect'),
        ].filter(Boolean);

        return (
          <li
            key={device.key}
            className="rd-peer-list-row"
            onPointerDown={(event) => startPress(device.key, event)}
            onPointerUp={endPress}
            onPointerCancel={endPress}
            onClickCapture={suppressSelect}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="flex-1 min-w-0 flex items-center gap-3 text-left bg-transparent border-0 p-0"
              onClick={() => onSelect(device)}
            >
              <div className="w-9 h-9 rounded-xl bg-[var(--rd-icon-tile-bg)] text-[var(--accent)] flex items-center justify-center shrink-0">
                {/mac/i.test(device.platform) ? <Laptop size={18} /> : <Monitor size={18} />}
              </div>

              <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(9rem,1.4fr)_minmax(0,11rem)_minmax(0,8.5rem)] sm:items-center sm:gap-4">
                <div className="rd-peer-name text-[14px] font-semibold text-[var(--ink)] truncate" title={title}>{title}</div>
                <div className="text-xs font-mono-tabular font-medium text-[var(--rd-id-ink)] truncate mt-0.5 sm:mt-0">
                  {primaryId}
                </div>
                <div className="hidden sm:block text-xs text-[var(--ink-soft)] truncate whitespace-nowrap text-right">
                  {metaParts.join(' · ')}
                </div>
              </div>
            </button>

            <DeviceActions
              locale={locale}
              title={title}
              favorite={device.favorite}
              menuOpen={menuKey === device.key}
              iconSize={16}
              starClass="w-9 h-9 inline-flex items-center justify-center rounded-lg border-0 bg-transparent text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)] hover:text-[#f59e0b]"
              extraClass="rd-peer-extra w-9 h-9 inline-flex items-center justify-center rounded-lg border-0 bg-transparent text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)]"
              onToggleMenu={() => setMenuKey((current) => current === device.key ? null : device.key)}
              onCloseMenu={() => setMenuKey(null)}
              onToggleFavorite={() => onToggleFavorite(device.key)}
              onRename={(alias) => onRename(device.key, alias)}
              onRemove={() => onRemove(device.key)}
            />
          </li>
        );
      })}
    </ul>
  );
}
