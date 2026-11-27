import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  KeyRound,
  Laptop,
  Monitor,
  MoreHorizontal,
  Pencil,
  Server,
  Smartphone,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { formatPeerId, type SavedDevice } from '../lib/devices';
import { t, type Locale } from '../lib/i18n';
import type { SavedPasswordMap } from '../lib/passwords';

interface PeerListProps {
  locale: Locale;
  devices: SavedDevice[];
  savedPasswords?: SavedPasswordMap;
  listTab: 'recent' | 'favorites';
  searchQuery: string;
  layout: 'grid' | 'list';
  onSelect: (device: SavedDevice) => void;
  onToggleFavorite: (key: string) => void;
  onRename?: (key: string, alias: string) => void;
  onClearSavedPassword?: (key: string) => void;
  onRemove: (key: string) => void;
}

function formatPrimaryId(device: SavedDevice): string {
  return device.mode === 'id'
    ? formatPeerId(device.peerId ?? '')
    : `${device.host ?? ''}:${device.port ?? '21118'}`;
}

function formatCopyTarget(device: SavedDevice): string {
  if (device.mode === 'id') return (device.peerId ?? '').replace(/\s+/g, '');
  const port = (device.port ?? '21118').trim();
  return port && port !== '21118' ? `${device.host ?? ''}:${port}` : (device.host ?? '');
}

export function PlatformIcon({ platform, size = 19 }: { platform: string; size?: number }) {
  if (/android|ios|iphone|ipad/i.test(platform)) return <Smartphone size={size} />;
  if (/mac/i.test(platform)) return <Laptop size={size} />;
  if (/linux|ubuntu|debian|centos|arch|fedora/i.test(platform)) return <Server size={size} />;
  return <Monitor size={size} />;
}

export function PeerList({
  locale,
  devices,
  savedPasswords = {},
  listTab,
  searchQuery,
  layout,
  onSelect,
  onToggleFavorite,
  onRename,
  onClearSavedPassword,
  onRemove,
}: PeerListProps) {
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<SavedDevice | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [removeTarget, setRemoveTarget] = useState<SavedDevice | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = useId();

  useEffect(() => {
    if (!menuKey) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-device-menu-root]')) return;
      setMenuKey(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuKey(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuKey]);

  useEffect(() => {
    if (!copiedKey) return;
    const timer = window.setTimeout(() => setCopiedKey(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copiedKey]);

  useLayoutEffect(() => {
    if (!renameTarget) return;
    const el = renameDialogRef.current;
    el?.showModal();
    renameInputRef.current?.select();
    return () => el?.close();
  }, [renameTarget]);

  useLayoutEffect(() => {
    if (!removeTarget) return;
    const el = removeDialogRef.current;
    el?.showModal();
    return () => el?.close();
  }, [removeTarget]);

  const handleCopyId = async (device: SavedDevice) => {
    const text = formatCopyTarget(device);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(device.key);
    } catch {
      // Ignore clipboard failures in restricted contexts
    }
    setMenuKey(null);
  };

  const openRename = (device: SavedDevice) => {
    setMenuKey(null);
    setRenameDraft(device.alias || '');
    setRenameTarget(device);
  };

  const openRemove = (device: SavedDevice) => {
    setMenuKey(null);
    setRemoveTarget(device);
  };

  const renderMenu = (device: SavedDevice, hasSavedPassword: boolean) => {
    if (menuKey !== device.key) return null;
    const isCopied = copiedKey === device.key;
    return (
      <div
        ref={menuRef}
        className="rd-device-menu"
        role="menu"
        data-testid="device-action-menu"
        data-device-menu-root
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          className="rd-device-menu-item"
          data-testid="device-menu-copy"
          onClick={() => void handleCopyId(device)}
        >
          {isCopied ? <Check size={14} className="text-[var(--ok)]" /> : <Copy size={14} />}
          <span>{isCopied ? t(locale, 'copiedNotice') : t(locale, 'copyIdAction')}</span>
        </button>

        {onRename && (
          <button
            type="button"
            role="menuitem"
            className="rd-device-menu-item"
            data-testid="device-menu-rename"
            onClick={() => openRename(device)}
          >
            <Pencil size={14} />
            <span>{t(locale, 'editAliasAction')}</span>
          </button>
        )}

        {hasSavedPassword && onClearSavedPassword && (
          <button
            type="button"
            role="menuitem"
            className="rd-device-menu-item"
            data-testid="device-menu-clear-password"
            onClick={() => {
              onClearSavedPassword(device.key);
              setMenuKey(null);
            }}
          >
            <KeyRound size={14} />
            <span>{t(locale, 'clearSavedPassword')}</span>
          </button>
        )}

        <div className="rd-device-menu-sep" role="separator" />

        <button
          type="button"
          role="menuitem"
          className="rd-device-menu-item danger"
          data-testid="device-menu-remove"
          onClick={() => openRemove(device)}
        >
          <Trash2 size={14} />
          <span>{t(locale, 'removeDevice')}</span>
        </button>
      </div>
    );
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

  return (
    <>
      {layout === 'grid' ? (
        <ul
          className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5"
          data-testid="device-list"
        >
          {devices.map((device) => {
            const primaryId = formatPrimaryId(device);
            const title = device.alias || device.hostname || primaryId;
            const hasSavedPassword = Boolean(savedPasswords[device.key]);
            const metaParts = [
              device.alias && device.hostname ? device.hostname : device.platform || null,
              device.mode === 'id' ? t(locale, 'modeId') : t(locale, 'modeDirect'),
            ].filter(Boolean);

            return (
              <li key={device.key} className="rd-device-card relative">
                <div className="flex items-start gap-2.5">
                  <button
                    type="button"
                    className="flex-1 min-w-0 flex items-center gap-3 text-left bg-transparent border-0 p-0"
                    onClick={() => onSelect(device)}
                  >
                    <div className="w-10 h-10 rounded-xl bg-[var(--rd-icon-tile-bg)] text-[var(--accent)] flex items-center justify-center shrink-0">
                      <PlatformIcon platform={device.platform} size={19} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold text-[var(--ink)] truncate">
                        {title}
                      </div>
                      <div className="text-xs font-mono-tabular font-medium text-[var(--rd-id-ink)] truncate mt-0.5">
                        {primaryId}
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center shrink-0 -mr-1 -mt-1 relative" data-device-menu-root>
                    <button
                      type="button"
                      className="w-8 h-8 inline-flex items-center justify-center rounded-lg border-0 bg-transparent text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)] hover:text-[#f59e0b]"
                      aria-label={
                        device.favorite ? t(locale, 'unfavoriteDevice') : t(locale, 'favoriteDevice')
                      }
                      data-tooltip={
                        device.favorite ? t(locale, 'unfavoriteDevice') : t(locale, 'favoriteDevice')
                      }
                      data-tooltip-pos="top"
                      aria-pressed={device.favorite}
                      onClick={() => onToggleFavorite(device.key)}
                    >
                      <Star
                        size={15}
                        className={device.favorite ? 'text-[#f59e0b] fill-[#f59e0b]' : ''}
                      />
                    </button>
                    <button
                      type="button"
                      className="w-8 h-8 inline-flex items-center justify-center rounded-lg border-0 bg-transparent text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)] hover:text-[var(--ink)]"
                      data-testid="device-menu-btn"
                      aria-label={`${t(locale, 'deviceActionsAria')} ${title}`}
                      aria-expanded={menuKey === device.key}
                      aria-haspopup="menu"
                      onClick={() => setMenuKey((prev) => (prev === device.key ? null : device.key))}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {renderMenu(device, hasSavedPassword)}
                  </div>
                </div>

                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 text-left bg-transparent border-0 p-0 pt-2.5 mt-2.5 border-t border-[var(--rd-divider)] text-xs text-[var(--ink-soft)]"
                  onClick={() => onSelect(device)}
                >
                  <span className="truncate">{metaParts.join(' · ')}</span>
                  {hasSavedPassword && (
                    <span
                      className="inline-flex items-center text-[var(--ok)] shrink-0"
                      title={t(locale, 'savedPasswordIndicator')}
                      aria-label={t(locale, 'savedPasswordIndicator')}
                    >
                      <KeyRound size={12} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="list-none m-0 p-0 rd-peer-list-panel" data-testid="device-list">
          {devices.map((device) => {
            const primaryId = formatPrimaryId(device);
            const title = device.alias || device.hostname || primaryId;
            const hasSavedPassword = Boolean(savedPasswords[device.key]);
            const metaParts = [
              device.alias && device.hostname ? device.hostname : device.platform || null,
              device.mode === 'id' ? t(locale, 'modeId') : t(locale, 'modeDirect'),
            ].filter(Boolean);

            return (
              <li key={device.key} className="rd-peer-list-row relative">
                <button
                  type="button"
                  className="flex-1 min-w-0 flex items-center gap-3 text-left bg-transparent border-0 p-0"
                  onClick={() => onSelect(device)}
                >
                  <div className="w-9 h-9 rounded-xl bg-[var(--rd-icon-tile-bg)] text-[var(--accent)] flex items-center justify-center shrink-0">
                    <PlatformIcon platform={device.platform} size={18} />
                  </div>

                  <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1fr)_168px_136px] sm:items-center sm:gap-4">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[14px] font-semibold text-[var(--ink)] truncate">{title}</span>
                      {hasSavedPassword && (
                        <KeyRound
                          size={12}
                          className="text-[var(--ok)] shrink-0"
                          aria-label={t(locale, 'savedPasswordIndicator')}
                        />
                      )}
                    </div>
                    <div className="text-xs font-mono-tabular font-medium text-[var(--rd-id-ink)] truncate mt-0.5 sm:mt-0">
                      {primaryId}
                    </div>
                    <div className="hidden sm:block text-xs text-[var(--ink-soft)] truncate whitespace-nowrap text-right">
                      {metaParts.join(' · ')}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-0.5 shrink-0 relative" data-device-menu-root>
                  <button
                    type="button"
                    className="w-9 h-9 inline-flex items-center justify-center rounded-lg border-0 bg-transparent text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)] hover:text-[#f59e0b]"
                    aria-label={
                      device.favorite ? t(locale, 'unfavoriteDevice') : t(locale, 'favoriteDevice')
                    }
                    data-tooltip={
                      device.favorite ? t(locale, 'unfavoriteDevice') : t(locale, 'favoriteDevice')
                    }
                    data-tooltip-pos="top"
                    aria-pressed={device.favorite}
                    onClick={() => onToggleFavorite(device.key)}
                  >
                    <Star
                      size={16}
                      className={device.favorite ? 'text-[#f59e0b] fill-[#f59e0b]' : ''}
                    />
                  </button>
                  <button
                    type="button"
                    className="w-9 h-9 inline-flex items-center justify-center rounded-lg border-0 bg-transparent text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)] hover:text-[var(--ink)]"
                    data-testid="device-menu-btn"
                    aria-label={`${t(locale, 'deviceActionsAria')} ${title}`}
                    aria-expanded={menuKey === device.key}
                    aria-haspopup="menu"
                    onClick={() => setMenuKey((prev) => (prev === device.key ? null : device.key))}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                  {renderMenu(device, hasSavedPassword)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {renameTarget &&
        createPortal(
          <dialog
            ref={renameDialogRef}
            className="session-confirm"
            data-session-confirm
            data-testid="device-rename-dialog"
            aria-labelledby={`${dialogId}-rename-title`}
            onCancel={(event) => {
              event.preventDefault();
              setRenameTarget(null);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) setRenameTarget(null);
            }}
          >
            <form
              className="session-confirm-content"
              onSubmit={(event) => {
                event.preventDefault();
                onRename?.(renameTarget.key, renameDraft);
                setRenameTarget(null);
              }}
            >
              <header>
                <h2 id={`${dialogId}-rename-title`}>{t(locale, 'editAliasAction')}</h2>
                <button
                  type="button"
                  className="dialog-close"
                  aria-label={t(locale, 'close')}
                  onClick={() => setRenameTarget(null)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="mt-3 mb-5">
                <div className="text-xs text-[var(--ink-soft)] mb-2 font-mono-tabular">
                  {renameTarget.hostname || formatPrimaryId(renameTarget)}
                </div>
                <input
                  ref={renameInputRef}
                  type="text"
                  className="rd-input"
                  data-testid="device-rename-input"
                  value={renameDraft}
                  placeholder={t(locale, 'editAliasPlaceholder')}
                  maxLength={64}
                  onChange={(e) => setRenameDraft(e.target.value)}
                />
              </div>
              <footer>
                <button type="button" className="rd-btn" onClick={() => setRenameTarget(null)}>
                  {t(locale, 'cancel')}
                </button>
                <button type="submit" className="rd-btn primary" data-testid="device-rename-save">
                  {t(locale, 'saveAction')}
                </button>
              </footer>
            </form>
          </dialog>,
          document.body,
        )}

      {removeTarget &&
        createPortal(
          <dialog
            ref={removeDialogRef}
            className="session-confirm"
            data-session-confirm
            data-testid="device-remove-dialog"
            aria-labelledby={`${dialogId}-remove-title`}
            aria-describedby={`${dialogId}-remove-desc`}
            onCancel={(event) => {
              event.preventDefault();
              setRemoveTarget(null);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) setRemoveTarget(null);
            }}
          >
            <div className="session-confirm-content">
              <header>
                <h2 id={`${dialogId}-remove-title`}>{t(locale, 'confirmRemoveDeviceTitle')}</h2>
                <button
                  type="button"
                  className="dialog-close"
                  aria-label={t(locale, 'close')}
                  onClick={() => setRemoveTarget(null)}
                >
                  <X size={18} />
                </button>
              </header>
              <p id={`${dialogId}-remove-desc`}>
                {t(locale, 'confirmRemoveDeviceBody')}
              </p>
              <footer>
                <button
                  type="button"
                  className="rd-btn"
                  autoFocus
                  onClick={() => setRemoveTarget(null)}
                >
                  {t(locale, 'cancel')}
                </button>
                <button
                  type="button"
                  className="rd-btn danger"
                  data-testid="device-remove-confirm"
                  onClick={() => {
                    onRemove(removeTarget.key);
                    setRemoveTarget(null);
                  }}
                >
                  {t(locale, 'removeDevice')}
                </button>
              </footer>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
