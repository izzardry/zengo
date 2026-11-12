/** Test helpers for the room UI (not shipped: only imported by tests). A fake controller and a toaster. */
import { render, type RenderOptions } from '@testing-library/react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { I18nProvider } from '@/lib/i18n';
import type { RoomControllerApi, RoomControllerOptions, RoomState } from '@/lib/room';
import { createStore, memoryStorage } from '@/lib/storage';
import type { Language, RoomNotice, RoomNoticeKind, RequestKind } from '@/lib/types';
import zigo, { makeSettings } from '@/lib/zigo';

// Radix measures with ResizeObserver, which jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// sonner captures the pointer on its toasts; jsdom has no pointer capture.
const proto = globalThis.Element?.prototype as (Element & Record<string, unknown>) | undefined;
if (proto && typeof proto.setPointerCapture !== 'function') {
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  proto.hasPointerCapture = () => false;
}

/** A complete room snapshot with sensible defaults (an open room, seat 0, waiting). */
export function fakeRoomState(patch: Partial<RoomState> = {}): RoomState {
  const base: RoomState = {
    code: 'K7QW2M',
    presence: 'waiting',
    role: 'anchor',
    lock: 'open',
    seat: 0,
    score: [0, 0],
    n: 1,
    epoch: 0,
    game: zigo.newGame(makeSettings(9)),
    color: 'B',
    tc: null,
    requests: {},
    locked: null,
    unsent: 0,
    clock: { paused: false, turnStart: null, turnUsed: 0 },
    notice: null,
    failure: null,
    phase: 'connecting',
    live: false,
    logs: [],
    myTurn: true,
    canMove: true,
    canMark: false,
    canAccept: false,
    canResume: false,
    canAsk: { takeback: false, rematch: false },
    failureKind: null,
    lastSeenAt: 0,
  };
  return Object.freeze({ ...base, ...patch });
}

/** A fake `RoomControllerApi`: tests set its snapshot and raise notices; every action is a spy. */
export interface FakeController extends RoomControllerApi {
  readonly opts: RoomControllerOptions;
  set(patch: Partial<RoomState>): void;
  notify(kind: RoomNoticeKind, request?: RequestKind): void;
  readonly move: ReturnType<typeof vi.fn> & RoomControllerApi['move'];
  readonly pass: ReturnType<typeof vi.fn> & RoomControllerApi['pass'];
  readonly mark: ReturnType<typeof vi.fn> & RoomControllerApi['mark'];
  readonly accept: ReturnType<typeof vi.fn> & RoomControllerApi['accept'];
  readonly resume: ReturnType<typeof vi.fn> & RoomControllerApi['resume'];
  readonly ask: ReturnType<typeof vi.fn> & RoomControllerApi['ask'];
  readonly reply: ReturnType<typeof vi.fn> & RoomControllerApi['reply'];
  readonly resign: ReturnType<typeof vi.fn> & RoomControllerApi['resign'];
  readonly flag: ReturnType<typeof vi.fn> & RoomControllerApi['flag'];
  readonly leave: ReturnType<typeof vi.fn> & RoomControllerApi['leave'];
  readonly attach: ReturnType<typeof vi.fn> & RoomControllerApi['attach'];
}

export function createFakeController(opts: RoomControllerOptions, init: Partial<RoomState> = {}): FakeController {
  let snap = fakeRoomState({
    code: opts.code,
    ...(opts.readOnly ? { phase: 'read-only', locked: 'other-tab' } : {}),
    ...init,
  });
  const subs = new Set<(s: RoomState) => void>();
  const noticeSubs = new Set<(n: RoomNotice) => void>();
  let seq = 0;
  const emit = () => {
    for (const cb of [...subs]) cb(snap);
  };
  const fake = {
    opts,
    get snapshot() {
      return snap;
    },
    transport: null,
    subscribe(cb: (s: RoomState) => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    onNotice(cb: (n: RoomNotice) => void) {
      noticeSubs.add(cb);
      return () => noticeSubs.delete(cb);
    },
    move: vi.fn(() => true),
    pass: vi.fn(() => true),
    mark: vi.fn(() => true),
    accept: vi.fn(() => true),
    resume: vi.fn(() => true),
    ask: vi.fn(() => true),
    reply: vi.fn(() => true),
    resign: vi.fn(() => true),
    flag: vi.fn(() => false),
    leave: vi.fn(() => {
      subs.clear();
      noticeSubs.clear();
    }),
    attach: vi.fn(),
    elapsed: () => 1234,
    idle: async () => {},
    set(patch: Partial<RoomState>) {
      snap = Object.freeze({ ...snap, ...patch });
      emit();
    },
    notify(kind: RoomNoticeKind, request?: RequestKind) {
      const n: RoomNotice = request ? { id: ++seq, kind, request } : { id: ++seq, kind };
      snap = Object.freeze({ ...snap, notice: n });
      for (const cb of [...noticeSubs]) cb(n);
      emit();
    },
  };
  return fake as unknown as FakeController;
}

/** Renders with i18n and a sonner Toaster placed as in App.tsx. */
export function renderRoom(ui: ReactElement, lang: Language = 'en', options?: RenderOptions) {
  // The provider only reads and writes the language preference; any store shape will do.
  const store = createStore(memoryStorage()) as unknown as ComponentProps<typeof I18nProvider>['store'];
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider language={lang} store={store}>
      {/* Before the page, as in App.tsx: the toaster subscribes before the page's effects toast. */}
      <Toaster />
      {children}
    </I18nProvider>
  );
  return render(ui, { wrapper: Wrapper, ...options });
}
