/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  ClipboardList,
  ShieldCheck,
  BadgeCheck,
  CalendarClock,
  FileText,
  Bell,
  Plus,
  Pencil,
  Trash2,
  Camera,
  Image as ImageIcon,
  Send,
  Eye,
  CheckCheck,
  Save,
  RotateCcw,
  CheckCircle2,
  Menu,
  LogOut,
  Users,
  AlertCircle,
  Clock,
  X,
  Download,
  Search,
  UserPlus,
  Upload,
  Calendar
} from 'lucide-react';
import { db, testConnection, handleFirestoreError, commitFirestoreWrite, OperationType } from './firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, getDoc, writeBatch } from 'firebase/firestore';
import {
  calculateAssignmentProgress,
  validateUserRegistration,
  validateRoleSpecificUserFields,
  authenticateUser,
  buildAssignmentsCsvReport,
  buildVerificationUpdate,
  formatWibDateTime,
  formatWibDateOnly,
  getWibDatePresets,
  filterAssignmentsByDateRange,
  summarizeAssignmentsByDay,
  getNavigationTabsForRole,
  serializeOfflineSnapshot,
  parseOfflineSnapshot,
  type SimsUser as User,
  type StudentGroup,
  type SimsAssignment as Assignment,
  type SimsSubmission as Submission,
} from './utils/simsLogic';
import { PWAInstallButton, OfflineIndicator, OfflineBadge } from './components/PWAComponents';
import { BulkImportUsersModal } from './components/BulkImportUsersModal';

const OFFLINE_SNAPSHOT_KEY = 'sims_offline_snapshot_v1';

interface NotificationItem {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  assignment_id?: number;
  is_read: boolean;
  created_at: string;
}

const TECHNICAL_BLUEPRINT = `# CETAK BIRU TEKNIS - SIMS Tugas (Firebase Cloud Firestore)

## 1. Arsitektur & Teknologi (SIMS Tugas)
- Frontend: React 19 + TypeScript + Tailwind CSS (Vite SPA).
- Backend / Persistence: Google Firebase Cloud Firestore (Real-time synced database).
- Autentikasi: Kredensial berbasis Username dan Kata Sandi terkelola aman.

## 2. Fitur Utama & Keamanan
- Siswa:
  - Daftar tugas dengan sinkronisasi real-time Firestore.
  - Pengumpulan bukti foto dengan kompresi otomatis max 1600px dan hash SHA-256.
- Guru / Administrator:
  - Dasbor Verifikasi pengumpulan siswa dengan persetujuan atau revisi bercatatan.
  - Manajemen tugas dan Ekspor Laporan ke CSV.
- Notifikasi & Cloud Sync:
  - Pemberitahuan status tugas secara real-time lintas perangkat.`;

export default function App() {
  const [users, setUsers] = useState<User[]>(() => {
    const snap = parseOfflineSnapshot(localStorage.getItem(OFFLINE_SNAPSHOT_KEY));
    return snap?.users ?? [];
  });
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('sims_current_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [assignments, setAssignments] = useState<Assignment[]>(() => {
    const snap = parseOfflineSnapshot(localStorage.getItem(OFFLINE_SNAPSHOT_KEY));
    return snap?.assignments ?? [];
  });
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isFirebaseReady, setIsFirebaseReady] = useState<boolean>(false);
  const [isDataLoaded, setIsDataLoaded] = useState<boolean>(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return Boolean(parseOfflineSnapshot(localStorage.getItem(OFFLINE_SNAPSHOT_KEY)));
    }
    return false;
  });
  const [hasPendingSync, setHasPendingSync] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>('');

  const [activeTab, setActiveTab] = useState<string>('tugas-saya');
  const [sideCollapsed, setSideCollapsed] = useState<boolean>(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<{ id: number; title: string; message: string; tone: string }[]>([]);

  // Selection states
  const [selectedStudentTaskId, setSelectedStudentTaskId] = useState<number | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const [reviewFilter, setReviewFilter] = useState<string>('Menunggu');
  const [reviewSearchQuery, setReviewSearchQuery] = useState<string>('');
  const [feedbackInput, setFeedbackInput] = useState<string>('');
  const [selectedTeacherTaskId, setSelectedTeacherTaskId] = useState<number | null>(null);
  const [taskStartDate, setTaskStartDate] = useState<string>('');
  const [taskEndDate, setTaskEndDate] = useState<string>('');

  // Modals
  const [submitModalTask, setSubmitModalTask] = useState<Assignment | null>(null);
  const [viewResultSub, setViewResultSub] = useState<{ assignment: Assignment; submission: Submission } | null>(null);
  const [editTaskModalData, setEditTaskModalData] = useState<Assignment | null | 'new'>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<Assignment | null>(null);
  const [verifyConfirmModal, setVerifyConfirmModal] = useState<{
    submission: Submission;
    assignment: Assignment;
    student: User;
    decision: 'Selesai' | 'Revisi';
    feedback: string;
  } | null>(null);
  const [isSubmittingVerify, setIsSubmittingVerify] = useState<boolean>(false);
  const [addUserOpen, setAddUserOpen] = useState<boolean>(false);
  const [bulkImportOpen, setBulkImportOpen] = useState<boolean>(false);
  const [userRoleFilter, setUserRoleFilter] = useState<'Semua' | 'Ikhwan' | 'Akhwat' | 'Guru' | 'Administrator'>('Semua');
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<User | null>(null);
  const [resetDataConfirmOpen, setResetDataConfirmOpen] = useState<boolean>(false);

  // Helper to clear all data collections in Firestore
  const clearAllFirestoreData = async () => {
    const colNames = ['users', 'assignments', 'submissions', 'notifications'];
    for (const colName of colNames) {
      try {
        const snap = await getDocs(collection(db, colName));
        for (const d of snap.docs) {
          await deleteDoc(doc(db, colName, d.id));
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, colName);
      }
    }
  };

  // Test connection and ensure clean empty initial state (offline-safe)
  useEffect(() => {
    let active = true;
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      setIsFirebaseReady(true);
      setIsDataLoaded(true);
      return () => {
        active = false;
      };
    }

    testConnection().then(async (ok) => {
      if (!active) return;
      if (!ok) {
        addToast('Mode Offline', 'Menggunakan data tersimpan lokal.', 'warning');
      }

      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const metaRef = doc(db, 'meta', 'app_v2');
          const metaSnap = await getDoc(metaRef);
          if (!metaSnap.exists()) {
            await clearAllFirestoreData();
            localStorage.removeItem('sims_current_user');
            if (active) setCurrentUser(null);
            await setDoc(metaRef, { initialized: true, resetAt: new Date().toISOString() });
          }
        } catch (error) {
          console.warn('Initialization check deferred (offline or unreachable):', error);
        }
      }

      if (active) setIsFirebaseReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Real-time Firestore sync (with IndexedDB offline cache & pending write tracking)
  useEffect(() => {
    if (!isFirebaseReady) return;

    let pendingFlags = { users: false, assignments: false, submissions: false, notifications: false };
    const syncPendingState = () => {
      setHasPendingSync(
        pendingFlags.users || pendingFlags.assignments || pendingFlags.submissions || pendingFlags.notifications
      );
    };

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      { includeMetadataChanges: true },
      (snap) => {
        pendingFlags.users = snap.metadata.hasPendingWrites;
        syncPendingState();
        const list: User[] = [];
        snap.forEach((d) => list.push(d.data() as User));
        list.sort((a, b) => a.id - b.id);
        setUsers(list);
        setIsDataLoaded(true);
      },
      (error) => {
        console.warn('Users snapshot warning:', error);
        setIsDataLoaded(true);
      }
    );

    const unsubAsg = onSnapshot(
      collection(db, 'assignments'),
      { includeMetadataChanges: true },
      (snap) => {
        pendingFlags.assignments = snap.metadata.hasPendingWrites;
        syncPendingState();
        const list: Assignment[] = [];
        snap.forEach((d) => list.push(d.data() as Assignment));
        list.sort((a, b) => b.id - a.id);
        setAssignments(list);
      },
      (error) => console.warn('Assignments snapshot warning:', error)
    );

    const unsubSubs = onSnapshot(
      collection(db, 'submissions'),
      { includeMetadataChanges: true },
      (snap) => {
        pendingFlags.submissions = snap.metadata.hasPendingWrites;
        syncPendingState();
        const list: Submission[] = [];
        snap.forEach((d) => list.push(d.data() as Submission));
        setSubmissions(list);
      },
      (error) => console.warn('Submissions snapshot warning:', error)
    );

    const unsubNotifs = onSnapshot(
      collection(db, 'notifications'),
      { includeMetadataChanges: true },
      (snap) => {
        pendingFlags.notifications = snap.metadata.hasPendingWrites;
        syncPendingState();
        const list: NotificationItem[] = [];
        snap.forEach((d) => list.push(d.data() as NotificationItem));
        list.sort((a, b) => b.id - a.id);
        setNotifications(list);
      },
      (error) => console.warn('Notifications snapshot warning:', error)
    );

    return () => {
      unsubUsers();
      unsubAsg();
      unsubSubs();
      unsubNotifs();
    };
  }, [isFirebaseReady]);

  // Persist lightweight offline snapshot mirror whenever users or assignments change
  useEffect(() => {
    if (!isDataLoaded) return;
    try {
      localStorage.setItem(
        OFFLINE_SNAPSHOT_KEY,
        serializeOfflineSnapshot({
          users,
          assignments,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch {
      // ignore storage quota errors
    }
  }, [users, assignments, isDataLoaded]);

  // Keep currentUser validated against live Firestore users (never log out if offline cache is empty)
  useEffect(() => {
    if (!isDataLoaded || !currentUser) return;
    if (users.length === 0 && typeof navigator !== 'undefined' && !navigator.onLine) return;
    const matched = users.find((u) => u.id === currentUser.id);
    if (!matched || !matched.active) {
      setCurrentUser(null);
    } else if (
      matched.name !== currentUser.name ||
      matched.role !== currentUser.role ||
      matched.username !== currentUser.username
    ) {
      setCurrentUser(matched);
    }
  }, [users, isDataLoaded, currentUser]);

  useEffect(() => {
    if (currentUser) localStorage.setItem('sims_current_user', JSON.stringify(currentUser));
    else localStorage.removeItem('sims_current_user');
  }, [currentUser]);

  // Set default tab on role switch
  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.role === 'Siswa') setActiveTab('tugas-saya');
    else if (currentUser.role === 'Guru') setActiveTab('verifikasi');
    else if (currentUser.role === 'Administrator') {
      const hasOtherRoles = users.some((u) => u.role !== 'Administrator');
      setActiveTab(hasOtherRoles ? 'verifikasi' : 'pengguna');
    }
  }, [currentUser?.role, currentUser?.id]);

  // Sync feedback input when selected review or filter changes
  useEffect(() => {
    const query = reviewSearchQuery.trim().toLowerCase();
    const filtered = submissions.filter((s) => {
      const matchesStatus = reviewFilter === 'Semua' || s.status === reviewFilter;
      if (!matchesStatus) return false;
      if (!query) return true;
      const st = users.find((u) => u.id === s.student_id);
      return (st?.name || '').toLowerCase().includes(query);
    });
    const activeSub = filtered.find((s) => s.id === selectedReviewId) || filtered[0] || null;
    setFeedbackInput(activeSub?.feedback || '');
  }, [selectedReviewId, reviewFilter, reviewSearchQuery, activeTab, submissions, users]);

  const addToast = (title: string, message: string = '', tone: string = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, title, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  const notifyUser = async (userId: number, type: string, title: string, message: string, assignmentId?: number) => {
    const newNotif: NotificationItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      user_id: userId,
      type,
      title,
      message,
      assignment_id: assignmentId,
      is_read: false,
      created_at: new Date().toISOString()
    };
    await commitFirestoreWrite(
      setDoc(doc(db, 'notifications', String(newNotif.id)), newNotif),
      OperationType.CREATE,
      `notifications/${newNotif.id}`
    );
  };

  const formatWib = formatWibDateTime;

  const getTimeLeft = (deadlineIso: string) => {
    const diffMs = new Date(deadlineIso).getTime() - Date.now();
    const absMin = Math.floor(Math.abs(diffMs) / 60000);
    const days = Math.floor(absMin / (60 * 24));
    const hours = Math.floor((absMin % (60 * 24)) / 60);
    const mins = absMin % 60;

    const parts = [];
    if (days > 0) parts.push(`${days} hari`);
    if (hours > 0) parts.push(`${hours} jam`);
    if (days === 0 && mins > 0) parts.push(`${mins} mnt`);
    if (parts.length === 0) parts.push('< 1 mnt');

    if (diffMs < 0) {
      return { text: `Terlewat ${parts.join(' ')}`, overdue: true, urgent: false };
    }
    const urgent = diffMs <= 3 * 3600 * 1000;
    return { text: `${parts.join(' ')} lagi`, overdue: false, urgent };
  };

  if (!isDataLoaded) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-slate-100">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30 animate-pulse">
            <GraduationCap className="w-8 h-8" />
          </div>
          <div className="text-sm font-medium text-slate-300">Menghubungkan ke SIMS Tugas...</div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    const isFirstSetup = users.length === 0;

    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-slate-100">
        <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-5 sm:p-8">
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 sm:w-12 sm:h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30 shrink-0">
                <GraduationCap className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold text-white truncate">SIMS Tugas</h1>
                <p className="text-xs text-slate-400 truncate">Sistem Manajemen Tugas Siswa</p>
              </div>
            </div>
            <OfflineBadge />
          </div>

          {isFirstSetup ? (
            <>
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 mb-5 space-y-1.5">
                <div className="flex items-center gap-2 text-purple-300 font-semibold text-sm">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Registrasi Administrator Utama</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Belum ada akun terdaftar. Daftarkan akun pertama Anda sekarang — akun ini otomatis menjadi{' '}
                  <strong className="text-white">Administrator</strong> untuk menambahkan akun Guru dan Siswa.
                </p>
              </div>

              {authError && (
                <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  {authError}
                </div>
              )}

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setAuthError('');
                  const form = e.currentTarget;
                  const nameInput = (form.elements.namedItem('name') as HTMLInputElement).value;
                  const usernameInput = (form.elements.namedItem('username') as HTMLInputElement).value;
                  const passwordInput = (form.elements.namedItem('password') as HTMLInputElement).value;
                  const confirmInput = (form.elements.namedItem('confirmPassword') as HTMLInputElement).value;

                  const validation = validateUserRegistration({
                    name: nameInput,
                    username: usernameInput,
                    password: passwordInput,
                    confirmPassword: confirmInput,
                    requireConfirm: true,
                  });
                  if (!validation.valid) {
                    setAuthError(validation.error);
                    return;
                  }

                  const newAdmin: User = {
                    id: Date.now(),
                    name: validation.cleanName,
                    username: validation.cleanUsername,
                    role: 'Administrator',
                    active: true,
                    password: passwordInput
                  };

                  try {
                    await commitFirestoreWrite(
                      setDoc(doc(db, 'users', String(newAdmin.id)), newAdmin),
                      OperationType.CREATE,
                      `users/${newAdmin.id}`
                    );
                    setCurrentUser(newAdmin);
                    setActiveTab('pengguna');
                    addToast(
                      'Akun Admin Terdaftar',
                      `Selamat datang, ${newAdmin.name}! Silakan tambahkan akun Guru dan Siswa.`,
                      'success'
                    );
                  } catch {
                    setAuthError('Gagal menyimpan akun ke Firestore. Coba lagi.');
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label htmlFor="setup-name" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Nama Lengkap
                  </label>
                  <input
                    id="setup-name"
                    type="text"
                    name="name"
                    placeholder="Contoh: Admin Sekolah"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="setup-username" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Username Admin
                  </label>
                  <input
                    id="setup-username"
                    type="text"
                    name="username"
                    placeholder="Contoh: admin"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="setup-password" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Kata Sandi
                  </label>
                  <input
                    id="setup-password"
                    type="password"
                    name="password"
                    placeholder="Minimal 4 karakter"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="setup-confirm" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Konfirmasi Kata Sandi
                  </label>
                  <input
                    id="setup-confirm"
                    type="password"
                    name="confirmPassword"
                    placeholder="Ulangi kata sandi"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold text-sm transition shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Daftar &amp; Masuk sebagai Admin</span>
                </button>
              </form>
            </>
          ) : (
            <>
              {authError && (
                <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  {authError}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setAuthError('');
                  const form = e.currentTarget;
                  const usernameInput = (form.elements.namedItem('username') as HTMLInputElement).value;
                  const passwordInput = (form.elements.namedItem('password') as HTMLInputElement).value;

                  const authRes = authenticateUser(users, usernameInput, passwordInput);
                  if (!authRes.ok) {
                    setAuthError(authRes.error);
                    return;
                  }
                  setCurrentUser(authRes.user);
                  addToast('Berhasil Masuk', `Selamat datang, ${authRes.user.name} (${authRes.user.role})`, 'success');
                }}
                className="space-y-4 mb-2"
              >
                <div>
                  <label htmlFor="login-username" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Username
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    name="username"
                    placeholder="Masukkan username dari admin"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="login-password" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Kata Sandi
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    name="password"
                    placeholder="Masukkan kata sandi"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold text-sm transition shadow-lg shadow-blue-600/30"
                >
                  Masuk
                </button>
              </form>
            </>
          )}

          <div className="mt-4 space-y-3">
            <PWAInstallButton variant="auth" />
            <div className="text-center text-xs text-slate-500">
              SIMS Tugas • Terhubung ke Cloud Firestore
            </div>
          </div>
        </div>
        <OfflineIndicator hasPendingSync={hasPendingSync} />
      </div>
    );
  }

  const unreadNotifsCount = notifications.filter((n) => n.user_id === currentUser.id && !n.is_read).length;
  const roleNavTabs = getNavigationTabsForRole(currentUser.role);
  const bottomNavTabs = roleNavTabs.filter((t) => t.showInBottomNav);

  const renderNavIcon = (id: string) => {
    if (id === 'tugas-saya') return <ClipboardList className="w-5 h-5 shrink-0" />;
    if (id === 'verifikasi') return <BadgeCheck className="w-5 h-5 shrink-0" />;
    if (id === 'kelola-tugas') return <CalendarClock className="w-5 h-5 shrink-0" />;
    if (id === 'cetak-biru') return <FileText className="w-5 h-5 shrink-0" />;
    if (id === 'pengguna') return <Users className="w-5 h-5 shrink-0" />;
    return <Bell className="w-5 h-5 shrink-0" />;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex font-sans">
      <OfflineIndicator hasPendingSync={hasPendingSync} />
      {/* Toast notifications */}
      <div className="fixed bottom-20 md:bottom-4 left-4 right-4 sm:left-auto sm:w-96 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto p-3.5 sm:p-4 rounded-xl shadow-xl border flex items-start gap-3 transition transform translate-y-0 animate-in fade-in slide-in-from-bottom-3 ${
              t.tone === 'success' ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200' :
              t.tone === 'warning' ? 'bg-amber-950/95 border-amber-500/50 text-amber-200' :
              t.tone === 'danger' ? 'bg-rose-950/95 border-rose-500/50 text-rose-200' :
              'bg-slate-900/95 border-slate-700 text-slate-200'
            }`}
          >
            <Bell className="w-5 h-5 mt-0.5 shrink-0 text-blue-400" />
            <div className="flex-1 text-sm min-w-0">
              <div className="font-semibold">{t.title}</div>
              {t.message && <div className="text-xs opacity-90 mt-0.5 break-words">{t.message}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Mobile Slide-Over Drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <button
            type="button"
            aria-label="Tutup menu navigasi"
            onClick={() => setMobileDrawerOpen(false)}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-slate-900 border-r border-slate-800 flex flex-col h-full shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md shadow-blue-600/30">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-base text-white leading-tight">SIMS Tugas</div>
                  <div className="text-[11px] text-slate-400">{currentUser.role}</div>
                </div>
              </div>
              <button
                type="button"
                aria-label="Tutup menu"
                onClick={() => setMobileDrawerOpen(false)}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
              {roleNavTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setMobileDrawerOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl font-medium text-sm transition ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {renderNavIcon(tab.id)}
                    <span>{tab.label}</span>
                  </div>
                  {tab.id === 'notifikasi' && unreadNotifsCount > 0 && (
                    <span className="bg-rose-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                      {unreadNotifsCount}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className="p-4 border-t border-slate-800 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-sm shrink-0">
                  {currentUser.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{currentUser.name}</div>
                  <div className="text-xs text-slate-400 truncate">@{currentUser.username}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileDrawerOpen(false);
                  setAuthError('');
                  setCurrentUser(null);
                  addToast('Keluar', 'Sesi Anda telah diakhiri.', 'info');
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl text-sm font-medium transition"
              >
                <LogOut className="w-4 h-4" />
                <span>Keluar Akun</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex bg-slate-900 border-r border-slate-800 flex-col transition-all duration-300 ${sideCollapsed ? 'w-20' : 'w-64'}`}>
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md shadow-blue-600/30">
              <GraduationCap className="w-5 h-5" />
            </div>
            {!sideCollapsed && <span className="font-bold text-lg tracking-tight text-white truncate">SIMS Tugas</span>}
          </div>
          <button
            onClick={() => setSideCollapsed(!sideCollapsed)}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
            title="Ciutkan Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-6 overflow-y-auto">
          {currentUser.role === 'Siswa' && (
            <div className="space-y-1">
              {!sideCollapsed && <div className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Siswa</div>}
              <button
                onClick={() => setActiveTab('tugas-saya')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition ${
                  activeTab === 'tugas-saya' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <ClipboardList className="w-5 h-5 shrink-0" />
                {!sideCollapsed && <span>Tugas Saya</span>}
              </button>
            </div>
          )}

          {(currentUser.role === 'Guru' || currentUser.role === 'Administrator') && (
            <div className="space-y-1">
              {!sideCollapsed && <div className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Guru / Admin</div>}
              <button
                onClick={() => setActiveTab('verifikasi')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition ${
                  activeTab === 'verifikasi' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <BadgeCheck className="w-5 h-5 shrink-0" />
                {!sideCollapsed && <span>Dasbor Verifikasi</span>}
              </button>
              <button
                onClick={() => setActiveTab('kelola-tugas')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition ${
                  activeTab === 'kelola-tugas' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <CalendarClock className="w-5 h-5 shrink-0" />
                {!sideCollapsed && <span>Kelola Tugas</span>}
              </button>
              <button
                onClick={() => setActiveTab('cetak-biru')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition ${
                  activeTab === 'cetak-biru' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <FileText className="w-5 h-5 shrink-0" />
                {!sideCollapsed && <span>Cetak Biru Teknis</span>}
              </button>
            </div>
          )}

          {currentUser.role === 'Administrator' && (
            <div className="space-y-1">
              {!sideCollapsed && <div className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Admin Sistem</div>}
              <button
                onClick={() => setActiveTab('pengguna')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition ${
                  activeTab === 'pengguna' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Users className="w-5 h-5 shrink-0" />
                {!sideCollapsed && <span>Pengguna</span>}
              </button>
            </div>
          )}

          <div className="space-y-1">
            {!sideCollapsed && <div className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Umum</div>}
            <button
              onClick={() => setActiveTab('notifikasi')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium text-sm transition ${
                activeTab === 'notifikasi' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Bell className="w-5 h-5 shrink-0" />
                {!sideCollapsed && <span>Notifikasi</span>}
              </div>
              {!sideCollapsed && unreadNotifsCount > 0 && (
                <span className="bg-rose-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                  {unreadNotifsCount}
                </span>
              )}
            </button>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
        <header className="h-16 border-b border-slate-800 bg-slate-900/60 backdrop-blur px-4 sm:px-6 flex items-center justify-between gap-2 z-20 sticky top-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              aria-label="Buka menu navigasi"
              onClick={() => setMobileDrawerOpen(true)}
              className="md:hidden p-2 -ml-1 hover:bg-slate-800 rounded-xl text-slate-300 hover:text-white transition shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-base sm:text-lg font-bold text-white capitalize truncate">
              {activeTab === 'tugas-saya' && 'Tugas Saya'}
              {activeTab === 'verifikasi' && 'Dasbor Verifikasi'}
              {activeTab === 'kelola-tugas' && 'Kelola Tugas Sekolah'}
              {activeTab === 'cetak-biru' && 'Cetak Biru Teknis'}
              {activeTab === 'pengguna' && 'Manajemen Pengguna'}
              {activeTab === 'notifikasi' && 'Pusat Notifikasi'}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <OfflineBadge />
            <PWAInstallButton variant="header" />
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-label="Menu akun pengguna"
                className="flex items-center gap-2.5 sm:gap-3 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 px-2.5 sm:px-3 py-1.5 rounded-xl transition"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-sm">
                  {currentUser.name.charAt(0)}
                </div>
                <div className="text-left hidden sm:block">
                  <div className="text-sm font-semibold text-white leading-tight">{currentUser.name}</div>
                  <div className="text-xs text-slate-400">{currentUser.role}</div>
                </div>
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-2 z-50">
                  <div className="p-3 border-b border-slate-800 mb-1">
                    <div className="font-semibold text-white text-sm">{currentUser.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">@{currentUser.username}</div>
                    <div className="mt-2 inline-block px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded-md border border-blue-500/20 font-medium">
                      {currentUser.role}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setAuthError('');
                      setCurrentUser(null);
                      setUserMenuOpen(false);
                      addToast('Keluar', 'Sesi Anda telah diakhiri.', 'info');
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-rose-400 hover:bg-rose-500/10 rounded-xl text-sm font-medium transition"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Keluar Akun</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 p-4 sm:p-6 pb-24 md:pb-6 overflow-y-auto">
          {/* TAB 1: TUGAS SAYA (SISWA) */}
          {activeTab === 'tugas-saya' && currentUser.role === 'Siswa' && (() => {
            const studentTasks = assignments.map((a) => {
              const sub = submissions.find((s) => s.assignment_id === a.id && s.student_id === currentUser.id);
              const tl = getTimeLeft(a.deadline);
              let displayStatus: string = sub?.status || '';
              if (!displayStatus) {
                displayStatus = tl.overdue ? 'Terlambat (Belum kumpul)' : 'Belum dikumpulkan';
              } else if (sub?.is_late && displayStatus !== 'Selesai') {
                displayStatus = `${displayStatus} (Terlambat)`;
              }
              return {
                ...a,
                sub,
                tl,
                displayStatus,
                canSubmit: a.status === 'Aktif' && sub?.status !== 'Selesai'
              };
            });

            const selectedTask = studentTasks.find((t) => t.id === selectedStudentTaskId) || null;

            return (
              <div className="space-y-4 sm:space-y-6 max-w-6xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 sm:p-6 rounded-2xl">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold text-white">Daftar Tugas Anda</h2>
                    <p className="text-xs sm:text-sm text-slate-400 mt-1">Pilih tugas di bawah untuk melihat instruksi dan mengumpulkan bukti foto.</p>
                  </div>
                  <div className="hidden md:flex items-center gap-3 shrink-0">
                    <button
                      disabled={!selectedTask?.canSubmit}
                      onClick={() => setSubmitModalTask(selectedTask)}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-xl font-semibold text-sm flex items-center gap-2 shadow-lg shadow-blue-600/30 transition whitespace-nowrap"
                    >
                      <Camera className="w-4 h-4 shrink-0" />
                      <span>Kumpulkan Bukti</span>
                    </button>
                    <button
                      disabled={!selectedTask?.sub}
                      onClick={() => {
                        if (selectedTask?.sub) {
                          setViewResultSub({ assignment: selectedTask, submission: selectedTask.sub });
                        }
                      }}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-xl font-semibold text-sm flex items-center gap-2 border border-slate-700 transition whitespace-nowrap"
                    >
                      <Eye className="w-4 h-4 shrink-0" />
                      <span>Lihat Hasil</span>
                    </button>
                  </div>
                </div>

                {/* Mobile Card List (Siswa) */}
                <div className="md:hidden space-y-3">
                  {studentTasks.length === 0 ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-500">
                      Belum ada tugas tersedia.
                    </div>
                  ) : (
                    studentTasks.map((t) => (
                      <div
                        key={t.id}
                        className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-white text-base">{t.title}</div>
                            <div className="text-xs text-slate-400 mt-0.5">{t.subject}</div>
                          </div>
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                            t.sub?.status === 'Selesai' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                            t.sub?.status === 'Revisi' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                            t.sub?.status === 'Menunggu' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                            'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}>
                            {t.displayStatus}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
                          <div>
                            <div className="text-slate-500">Tenggat</div>
                            <div className="text-slate-200 font-medium mt-0.5">{formatWib(t.deadline)}</div>
                          </div>
                          <div>
                            <div className="text-slate-500">Sisa Waktu</div>
                            <div className={`font-medium mt-0.5 ${t.tl.overdue ? 'text-rose-400' : t.tl.urgent ? 'text-amber-400' : 'text-slate-200'}`}>
                              {t.tl.text}
                            </div>
                          </div>
                          {t.sub && (
                            <div className="col-span-2 pt-1 border-t border-slate-800/70">
                              <span className="text-slate-500">Dikumpulkan: </span>
                              <span className="text-slate-300">{formatWib(t.sub.submitted_at)}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={!t.canSubmit}
                            onClick={() => {
                              setSelectedStudentTaskId(t.id);
                              setSubmitModalTask(t);
                            }}
                            className="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-45 text-white rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                          >
                            <Camera className="w-4 h-4 shrink-0" />
                            <span>Kumpulkan Bukti</span>
                          </button>
                          <button
                            type="button"
                            disabled={!t.sub}
                            onClick={() => {
                              if (t.sub) {
                                setSelectedStudentTaskId(t.id);
                                setViewResultSub({ assignment: t, submission: t.sub });
                              }
                            }}
                            className="flex-1 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-45 text-slate-200 border border-slate-700 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                          >
                            <Eye className="w-4 h-4 shrink-0" />
                            <span>Lihat Hasil</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Desktop Table (Siswa) */}
                <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider bg-slate-900/50">
                        <th className="p-4 font-semibold">Tugas</th>
                        <th className="p-4 font-semibold">Mapel</th>
                        <th className="p-4 font-semibold">Tenggat</th>
                        <th className="p-4 font-semibold">Sisa Waktu</th>
                        <th className="p-4 font-semibold">Status</th>
                        <th className="p-4 font-semibold">Dikumpulkan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-sm">
                      {studentTasks.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-slate-500">Belum ada tugas tersedia.</td>
                        </tr>
                      ) : (
                        studentTasks.map((t) => (
                          <tr
                            key={t.id}
                            onClick={() => setSelectedStudentTaskId(t.id)}
                            className={`cursor-pointer transition hover:bg-slate-800/50 ${
                              selectedStudentTaskId === t.id ? 'bg-blue-600/10 border-l-4 border-blue-500' : ''
                            }`}
                          >
                            <td className="p-4 font-semibold text-white">{t.title}</td>
                            <td className="p-4 text-slate-300">{t.subject}</td>
                            <td className="p-4 text-slate-300">{formatWib(t.deadline)}</td>
                            <td className="p-4">
                              <span className={t.tl.overdue ? 'text-rose-400 font-medium' : t.tl.urgent ? 'text-amber-400 font-medium' : 'text-slate-300'}>
                                {t.tl.text}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                t.sub?.status === 'Selesai' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                t.sub?.status === 'Revisi' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                                t.sub?.status === 'Menunggu' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                                'bg-slate-800 text-slate-300 border border-slate-700'
                              }`}>
                                {t.displayStatus}
                              </span>
                            </td>
                            <td className="p-4 text-slate-400">{t.sub ? formatWib(t.sub.submitted_at) : '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* TAB 2: DASBOR VERIFIKASI (GURU / ADMIN) */}
          {activeTab === 'verifikasi' && (currentUser.role === 'Guru' || currentUser.role === 'Administrator') && (() => {
            const searchTerm = reviewSearchQuery.trim().toLowerCase();
            const filteredSubs = submissions.filter((s) => {
              const matchesStatus = reviewFilter === 'Semua' || s.status === reviewFilter;
              if (!matchesStatus) return false;
              if (!searchTerm) return true;
              const stUser = users.find((u) => u.id === s.student_id);
              return (stUser?.name || '').toLowerCase().includes(searchTerm);
            });

            const selectedSub = filteredSubs.find((s) => s.id === selectedReviewId) || filteredSubs[0] || null;
            const selectedAssignment = selectedSub ? assignments.find((a) => a.id === selectedSub.assignment_id) : null;
            const studentWhoSubmitted = selectedSub ? users.find((u) => u.id === selectedSub.student_id) : null;

            return (
              <div className="space-y-6 max-w-7xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                  <div>
                    <h2 className="text-xl font-bold text-white">Dasbor Verifikasi Tugas Siswa</h2>
                    <p className="text-sm text-slate-400 mt-1">Periksa foto bukti pengumpulan, verifikasi ketepatan, dan berikan catatan atau revisi.</p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={reviewSearchQuery}
                        onChange={(e) => setReviewSearchQuery(e.target.value)}
                        placeholder="Cari nama siswa..."
                        aria-label="Cari nama siswa"
                        className="w-full sm:w-64 bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-10 pr-8 py-2.5 outline-none focus:border-blue-500 placeholder:text-slate-400"
                      />
                      {reviewSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setReviewSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                          title="Bersihkan pencarian"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <select
                      value={reviewFilter}
                      onChange={(e) => setReviewFilter(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2.5 outline-none focus:border-blue-500"
                    >
                      <option value="Menunggu">Menunggu Verifikasi</option>
                      <option value="Revisi">Revisi</option>
                      <option value="Selesai">Selesai</option>
                      <option value="Semua">Semua Pengumpulan</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
                  {/* Mobile Submissions List */}
                  <div className="md:hidden space-y-2.5">
                    {filteredSubs.length === 0 ? (
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-sm text-slate-500">
                        Tidak ada pengumpulan pada filter ini.
                      </div>
                    ) : (
                      filteredSubs.map((s) => {
                        const stUser = users.find((u) => u.id === s.student_id);
                        const asg = assignments.find((a) => a.id === s.assignment_id);
                        const isSelected = selectedSub?.id === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setSelectedReviewId(s.id);
                              setFeedbackInput(s.feedback || '');
                            }}
                            className={`w-full text-left p-4 rounded-2xl border transition space-y-1.5 ${
                              isSelected
                                ? 'bg-blue-600/10 border-blue-500'
                                : 'bg-slate-900 border-slate-800 hover:bg-slate-800/60'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold text-white text-sm">{stUser?.name || 'Siswa'}</span>
                                {stUser?.student_group && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                                      stUser.student_group === 'Ikhwan'
                                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                        : 'bg-pink-500/15 text-pink-300 border-pink-500/30'
                                    }`}
                                  >
                                    {stUser.student_group}
                                  </span>
                                )}
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${
                                s.status === 'Selesai' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                s.status === 'Revisi' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                                'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}>
                                {s.status} {s.is_late && '(Terlambat)'}
                              </span>
                            </div>
                            <div className="text-xs text-slate-300 truncate">{asg?.title || '-'}</div>
                            <div className="text-[11px] text-slate-400">{formatWib(s.submitted_at)}</div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* Desktop Table */}
                  <div className="hidden md:block lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider bg-slate-900/50">
                          <th className="p-4 font-semibold">Siswa</th>
                          <th className="p-4 font-semibold">Tugas</th>
                          <th className="p-4 font-semibold">Waktu Kumpul</th>
                          <th className="p-4 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-sm">
                        {filteredSubs.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="p-8 text-center text-slate-500">Tidak ada pengumpulan pada filter ini.</td>
                          </tr>
                        ) : (
                          filteredSubs.map((s) => {
                            const stUser = users.find((u) => u.id === s.student_id);
                            const asg = assignments.find((a) => a.id === s.assignment_id);
                            return (
                              <tr
                                key={s.id}
                                onClick={() => {
                                  setSelectedReviewId(s.id);
                                  setFeedbackInput(s.feedback || '');
                                }}
                                className={`cursor-pointer transition hover:bg-slate-800/50 ${
                                  (selectedSub?.id === s.id) ? 'bg-blue-600/10 border-l-4 border-blue-500' : ''
                                }`}
                              >
                                <td className="p-4 font-semibold text-white">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span>{stUser?.name || 'Siswa'}</span>
                                    {stUser?.student_group && (
                                      <span
                                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                          stUser.student_group === 'Ikhwan'
                                            ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                            : 'bg-pink-500/15 text-pink-300 border-pink-500/30'
                                        }`}
                                      >
                                        {stUser.student_group}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-4 text-slate-300 truncate max-w-[200px]">{asg?.title || '-'}</td>
                                <td className="p-4 text-slate-400 text-xs">{formatWib(s.submitted_at)}</td>
                                <td className="p-4">
                                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                    s.status === 'Selesai' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                    s.status === 'Revisi' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                                    'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  }`}>
                                    {s.status} {s.is_late && '(Terlambat)'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Inspector Panel */}
                  <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col gap-4">
                    <h3 className="text-base font-bold text-white border-b border-slate-800 pb-3">Detail & Verifikasi Bukti</h3>
                    {selectedSub && selectedAssignment && studentWhoSubmitted ? (
                      <>
                        <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center h-64">
                          <img src={selectedSub.photo_data} alt="Bukti Tugas" className="max-h-full max-w-full object-contain" />
                        </div>
                        <div className="space-y-2 text-sm bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <strong className="text-white">Siswa:</strong>{' '}
                            <span>{studentWhoSubmitted.name}</span>
                            {studentWhoSubmitted.student_group && (
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                  studentWhoSubmitted.student_group === 'Ikhwan'
                                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                    : 'bg-pink-500/15 text-pink-300 border-pink-500/30'
                                }`}
                              >
                                {studentWhoSubmitted.student_group}
                              </span>
                            )}
                          </div>
                          <div><strong className="text-white">Tugas:</strong> {selectedAssignment.title}</div>
                          <div><strong className="text-white">Waktu:</strong> {formatWib(selectedSub.submitted_at)} {selectedSub.is_late ? <span className="text-rose-400 font-semibold">(Terlambat)</span> : <span className="text-emerald-400">(Tepat waktu)</span>}</div>
                          {selectedSub.note && <div><strong className="text-white">Catatan Siswa:</strong> {selectedSub.note}</div>}
                          <div className="font-mono text-xs text-slate-500 truncate">SHA-256: {selectedSub.photo_sha256}</div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Catatan / Umpan Balik Guru</label>
                          <textarea
                            value={feedbackInput}
                            onChange={(e) => setFeedbackInput(e.target.value)}
                            placeholder="Tuliskan catatan atau alasan revisi di sini..."
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500 h-24 resize-none"
                          />
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                          <button
                            onClick={() => {
                              if (!feedbackInput.trim()) {
                                addToast('Catatan Diperlukan', 'Mohon isi catatan atau alasan revisi terlebih dahulu.', 'warning');
                                return;
                              }
                              setVerifyConfirmModal({
                                submission: selectedSub,
                                assignment: selectedAssignment,
                                student: studentWhoSubmitted,
                                decision: 'Revisi',
                                feedback: feedbackInput
                              });
                            }}
                            className="flex-1 px-4 py-2.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2"
                          >
                            <RotateCcw className="w-4 h-4" />
                            <span>Minta Revisi</span>
                          </button>
                          <button
                            onClick={() => {
                              setVerifyConfirmModal({
                                submission: selectedSub,
                                assignment: selectedAssignment,
                                student: studentWhoSubmitted,
                                decision: 'Selesai',
                                feedback: feedbackInput
                              });
                            }}
                            className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Setujui (Selesai)</span>
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="py-20 text-center text-slate-500">Pilih pengumpulan dari tabel di sebelah kiri.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TAB 3: KELOLA TUGAS (GURU / ADMIN) */}
          {activeTab === 'kelola-tugas' && (currentUser.role === 'Guru' || currentUser.role === 'Administrator') && (() => {
            const hasDateFilter = Boolean(taskStartDate || taskEndDate);
            const isInvalidDateRange = Boolean(taskStartDate && taskEndDate && taskStartDate > taskEndDate);
            const filteredAssignments = filterAssignmentsByDateRange(assignments, taskStartDate, taskEndDate);
            const periodSummary = summarizeAssignmentsByDay(filteredAssignments);
            const datePresets = getWibDatePresets();

            return (
              <div className="space-y-6 max-w-6xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                  <div>
                    <h2 className="text-xl font-bold text-white">Kelola Tugas Sekolah</h2>
                    <p className="text-sm text-slate-400 mt-1">Buat tugas baru, pantau frekuensi pemberian tugas per hari, atau ubah dan hapus tugas aktif.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <button
                      onClick={() => {
                        const targetAssignments = hasDateFilter ? filteredAssignments : assignments;
                        const csvContent = buildAssignmentsCsvReport(targetAssignments, users, submissions);
                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        const dateStamp = new Date().toISOString().slice(0, 10);
                        link.href = url;
                        link.setAttribute('download', `laporan-tugas-sims-tugas-${dateStamp}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                        addToast(
                          'Export Berhasil',
                          hasDateFilter
                            ? `Laporan CSV (${targetAssignments.length} tugas pada periode terpilih) telah diunduh.`
                            : 'Laporan CSV status tugas siswa telah diunduh.',
                          'success'
                        );
                      }}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-semibold text-sm flex items-center gap-2 transition whitespace-nowrap"
                    >
                      <Download className="w-4 h-4 shrink-0" />
                      <span>Export to CSV</span>
                    </button>
                    <button
                      onClick={() => setEditTaskModalData('new')}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold text-sm flex items-center gap-2 shadow-lg shadow-blue-600/30 transition whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4 shrink-0" />
                      <span>Tugas Baru</span>
                    </button>
                  </div>
                </div>

                {/* Filter Rentang Tanggal & Ringkasan Hari Pemberian Tugas */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                    <div className="space-y-3 w-full lg:w-auto">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex items-end gap-3">
                        <div className="w-full sm:w-auto">
                          <label htmlFor="task-filter-start" className="block text-xs font-semibold text-slate-400 mb-1.5">
                            Dari Tanggal (Dibuat)
                          </label>
                          <input
                            id="task-filter-start"
                            type="date"
                            value={taskStartDate}
                            onChange={(e) => setTaskStartDate(e.target.value)}
                            className="w-full sm:w-auto bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2 text-sm text-white outline-none [color-scheme:dark]"
                          />
                        </div>
                        <div className="w-full sm:w-auto">
                          <label htmlFor="task-filter-end" className="block text-xs font-semibold text-slate-400 mb-1.5">
                            Sampai Tanggal (Dibuat)
                          </label>
                          <input
                            id="task-filter-end"
                            type="date"
                            value={taskEndDate}
                            onChange={(e) => setTaskEndDate(e.target.value)}
                            className="w-full sm:w-auto bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2 text-sm text-white outline-none [color-scheme:dark]"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                          <button
                            type="button"
                            onClick={() => {
                              setTaskStartDate(datePresets.today);
                              setTaskEndDate(datePresets.today);
                            }}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                              taskStartDate === datePresets.today && taskEndDate === datePresets.today
                                ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                                : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                            }`}
                          >
                            Hari Ini
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTaskStartDate(datePresets.last7Start);
                              setTaskEndDate(datePresets.today);
                            }}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                              taskStartDate === datePresets.last7Start && taskEndDate === datePresets.today
                                ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                                : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                            }`}
                          >
                            7 Hari Terakhir
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTaskStartDate(datePresets.monthStart);
                              setTaskEndDate(datePresets.today);
                            }}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                              taskStartDate === datePresets.monthStart && taskEndDate === datePresets.today
                                ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                                : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                            }`}
                          >
                            Bulan Ini
                          </button>
                          {hasDateFilter && (
                            <button
                              type="button"
                              onClick={() => {
                                setTaskStartDate('');
                                setTaskEndDate('');
                              }}
                              className="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-600/15 hover:bg-rose-600/25 text-rose-300 border border-rose-500/30 transition flex items-center gap-1.5"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Reset Filter</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 lg:flex items-center gap-3 shrink-0">
                      <div className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 sm:px-4 py-2.5">
                        <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Total Tugas</div>
                        <div className="text-base sm:text-lg font-bold text-white">
                          {periodSummary.totalAssignments} <span className="text-xs font-normal text-slate-400">kali{hasDateFilter ? ` / ${assignments.length}` : ''}</span>
                        </div>
                      </div>
                      <div className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 sm:px-4 py-2.5">
                        <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Hari Pembuatan</div>
                        <div className="text-base sm:text-lg font-bold text-blue-400">
                          {periodSummary.activeDaysCount} <span className="text-xs font-normal text-slate-400">hari</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isInvalidDateRange && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Rentang tanggal tidak valid: tanggal mulai lebih besar dari tanggal akhir.</span>
                    </div>
                  )}

                  {!isInvalidDateRange && (
                    <div className="border-t border-slate-800/80 pt-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-2">
                        <Calendar className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span>Riwayat Hari Pembuatan Tugas {hasDateFilter ? '(Periode Terpilih)' : '(Semua Periode)'}:</span>
                      </div>
                      {periodSummary.days.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          {assignments.length === 0
                            ? 'Belum ada riwayat hari pembuatan tugas.'
                            : 'Tidak ada tugas yang dibuat pada rentang tanggal ini.'}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {periodSummary.days.map((day) => {
                            const isDaySelected = taskStartDate === day.dateKey && taskEndDate === day.dateKey;
                            return (
                              <button
                                key={day.dateKey}
                                type="button"
                                onClick={() => {
                                  if (isDaySelected) {
                                    setTaskStartDate('');
                                    setTaskEndDate('');
                                  } else {
                                    setTaskStartDate(day.dateKey);
                                    setTaskEndDate(day.dateKey);
                                  }
                                }}
                                title={day.titles.join(', ')}
                                className={`px-3 py-1.5 rounded-xl text-xs border transition flex items-center gap-2 ${
                                  isDaySelected
                                    ? 'bg-blue-600/20 text-blue-200 border-blue-500/50 font-semibold'
                                    : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                                }`}
                              >
                                <span>{day.dayLabel}</span>
                                <span className="px-1.5 py-0.5 rounded-md bg-slate-800 text-blue-300 font-semibold">
                                  {day.count} tugas
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Mobile Cards (Kelola Tugas) */}
                <div className="md:hidden space-y-3">
                  {assignments.length === 0 ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-500">
                      Belum ada tugas. Klik &ldquo;Tugas Baru&rdquo; untuk membuat tugas pertama.
                    </div>
                  ) : filteredAssignments.length === 0 ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-400 space-y-3">
                      <div>Tidak ada tugas yang dibuat pada rentang tanggal yang dipilih.</div>
                      {hasDateFilter && (
                        <button
                          type="button"
                          onClick={() => {
                            setTaskStartDate('');
                            setTaskEndDate('');
                          }}
                          className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Tampilkan Semua Tugas</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredAssignments.map((a) => {
                      const tl = getTimeLeft(a.deadline);
                      const { submittedCount, totalStudents, progressPercent } = calculateAssignmentProgress(
                        a.id,
                        users,
                        submissions
                      );
                      return (
                        <div key={a.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-white text-base">{a.title}</div>
                              <div className="text-xs text-slate-400 mt-0.5">{a.subject}</div>
                            </div>
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                              a.status === 'Aktif' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                            }`}>
                              {a.status}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
                            <div>
                              <div className="text-slate-500">Dibuat</div>
                              <div className="text-slate-200 font-medium mt-0.5">{formatWibDateOnly(a.created_at, true)}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Tenggat</div>
                              <div className="text-slate-200 font-medium mt-0.5">{formatWib(a.deadline)}</div>
                            </div>
                            <div className="col-span-2 pt-1 border-t border-slate-800/70 flex items-center justify-between">
                              <span className="text-slate-500">Sisa Waktu:</span>
                              <span className={tl.overdue ? 'text-rose-400 font-medium' : 'text-slate-300'}>{tl.text}</span>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-200">{submittedCount} / {totalStudents} siswa</span>
                              <span className="text-slate-400 font-semibold">{progressPercent}%</span>
                            </div>
                            <div
                              role="progressbar"
                              aria-valuenow={progressPercent}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`Progres pengumpulan ${a.title}`}
                              className="w-full h-2 bg-slate-800 rounded-full overflow-hidden"
                            >
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  progressPercent === 100
                                    ? 'bg-emerald-500'
                                    : progressPercent > 0
                                    ? 'bg-blue-500'
                                    : 'bg-slate-700'
                                }`}
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditTaskModalData(a)}
                              className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5"
                            >
                              <Pencil className="w-3.5 h-3.5" /> Ubah
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmTask(a)}
                              className="flex-1 py-2 px-3 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Hapus
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Desktop Table (Kelola Tugas) */}
                <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider bg-slate-900/50">
                        <th className="p-4 font-semibold">Tugas</th>
                        <th className="p-4 font-semibold">Mapel</th>
                        <th className="p-4 font-semibold">Dibuat (WIB)</th>
                        <th className="p-4 font-semibold">Tenggat</th>
                        <th className="p-4 font-semibold">Sisa Waktu</th>
                        <th className="p-4 font-semibold">Status</th>
                        <th className="p-4 font-semibold">Progres Pengumpulan</th>
                        <th className="p-4 font-semibold text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-sm">
                      {assignments.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-500">
                            Belum ada tugas. Klik &ldquo;Tugas Baru&rdquo; untuk membuat tugas pertama.
                          </td>
                        </tr>
                      ) : filteredAssignments.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-400 space-y-3">
                            <div>Tidak ada tugas yang dibuat pada rentang tanggal yang dipilih.</div>
                            {hasDateFilter && (
                              <button
                                type="button"
                                onClick={() => {
                                  setTaskStartDate('');
                                  setTaskEndDate('');
                                }}
                                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Tampilkan Semua Tugas</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ) : (
                        filteredAssignments.map((a) => {
                          const tl = getTimeLeft(a.deadline);
                          const { submittedCount, totalStudents, progressPercent } = calculateAssignmentProgress(
                            a.id,
                            users,
                            submissions
                          );

                          return (
                            <tr key={a.id} className="hover:bg-slate-800/50 transition">
                              <td className="p-4 font-semibold text-white">{a.title}</td>
                              <td className="p-4 text-slate-300">{a.subject}</td>
                              <td className="p-4 text-slate-300">
                                <div className="font-medium text-slate-200">{formatWibDateOnly(a.created_at, true)}</div>
                                <div className="text-xs text-slate-400">{formatWib(a.created_at)}</div>
                              </td>
                              <td className="p-4 text-slate-300">{formatWib(a.deadline)}</td>
                              <td className="p-4">
                                <span className={tl.overdue ? 'text-rose-400 font-medium' : 'text-slate-300'}>{tl.text}</span>
                              </td>
                              <td className="p-4">
                                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                  a.status === 'Aktif' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                                }`}>
                                  {a.status}
                                </span>
                              </td>
                              <td className="p-4 min-w-[180px]">
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-medium text-slate-200">
                                      {submittedCount} / {totalStudents} siswa
                                    </span>
                                    <span className="text-slate-400 font-semibold">{progressPercent}%</span>
                                  </div>
                                  <div
                                    role="progressbar"
                                    aria-valuenow={progressPercent}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-label={`Progres pengumpulan ${a.title}`}
                                    className="w-full h-2 bg-slate-800 rounded-full overflow-hidden"
                                  >
                                    <div
                                      className={`h-full rounded-full transition-all duration-300 ${
                                        progressPercent === 100
                                          ? 'bg-emerald-500'
                                          : progressPercent > 0
                                          ? 'bg-blue-500'
                                          : 'bg-slate-700'
                                      }`}
                                      style={{ width: `${progressPercent}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="p-4 text-right space-x-2 whitespace-nowrap">
                                <button
                                  onClick={() => setEditTaskModalData(a)}
                                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5"
                                >
                                  <Pencil className="w-3.5 h-3.5" /> Ubah
                                </button>
                                <button
                                  onClick={() => setDeleteConfirmTask(a)}
                                  className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Hapus
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* TAB 4: CETAK BIRU TEKNIS */}
          {activeTab === 'cetak-biru' && (currentUser.role === 'Guru' || currentUser.role === 'Administrator') && (
            <div className="max-w-4xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
              <h2 className="text-xl font-bold text-white mb-4">Cetak Biru Teknis Sistem (SIMS Tugas)</h2>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 font-mono text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                {TECHNICAL_BLUEPRINT}
              </div>
            </div>
          )}

          {/* TAB 5: PENGGUNA (ADMINISTRATOR) */}
          {activeTab === 'pengguna' && currentUser.role === 'Administrator' && (() => {
            const filteredUsers = users.filter((u) => {
              if (userRoleFilter === 'Semua') return true;
              if (userRoleFilter === 'Ikhwan') return u.role === 'Siswa' && u.student_group === 'Ikhwan';
              if (userRoleFilter === 'Akhwat') return u.role === 'Siswa' && u.student_group === 'Akhwat';
              if (userRoleFilter === 'Guru') return u.role === 'Guru';
              if (userRoleFilter === 'Administrator') return u.role === 'Administrator';
              return true;
            });

            const filterCounts = {
              Semua: users.length,
              Ikhwan: users.filter((u) => u.role === 'Siswa' && u.student_group === 'Ikhwan').length,
              Akhwat: users.filter((u) => u.role === 'Siswa' && u.student_group === 'Akhwat').length,
              Guru: users.filter((u) => u.role === 'Guru').length,
              Administrator: users.filter((u) => u.role === 'Administrator').length,
            };

            return (
              <div className="space-y-6 max-w-5xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                  <div>
                    <h2 className="text-xl font-bold text-white">Manajemen Pengguna</h2>
                    <p className="text-sm text-slate-400 mt-1">Tambahkan akun Siswa (Ikhwan / Akhwat), Guru (beserta mata pelajaran), atau Administrator.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <button
                      onClick={() => setResetDataConfirmOpen(true)}
                      className="px-4 py-2.5 bg-rose-600/15 hover:bg-rose-600/25 text-rose-300 border border-rose-500/30 rounded-xl font-semibold text-sm flex items-center gap-2 transition whitespace-nowrap"
                    >
                      <RotateCcw className="w-4 h-4 shrink-0" />
                      <span>Kosongkan Data</span>
                    </button>
                    <button
                      onClick={() => setBulkImportOpen(true)}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-xl font-semibold text-sm flex items-center gap-2 transition whitespace-nowrap"
                    >
                      <Upload className="w-4 h-4 shrink-0" />
                      <span>Bulk Import Users</span>
                    </button>
                    <button
                      onClick={() => setAddUserOpen(true)}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold text-sm flex items-center gap-2 shadow-lg shadow-blue-600/30 transition whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4 shrink-0" />
                      <span>Tambah Pengguna</span>
                    </button>
                  </div>
                </div>

                {/* Filter Peran & Kategori Siswa */}
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      { key: 'Semua', label: 'Semua' },
                      { key: 'Ikhwan', label: 'Siswa Ikhwan' },
                      { key: 'Akhwat', label: 'Siswa Akhwat' },
                      { key: 'Guru', label: 'Guru' },
                      { key: 'Administrator', label: 'Administrator' },
                    ] as const
                  ).map((item) => {
                    const active = userRoleFilter === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setUserRoleFilter(item.key)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 ${
                          active
                            ? 'bg-blue-600/20 text-blue-200 border-blue-500/50'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className="px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[11px]">
                          {filterCounts[item.key]}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Mobile User Cards */}
                <div className="md:hidden space-y-3">
                  {filteredUsers.length === 0 ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-sm text-slate-500">
                      Belum ada pengguna pada kategori ini.
                    </div>
                  ) : (
                    filteredUsers.map((u) => (
                      <div key={u.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-white text-sm">
                              {u.name}{' '}
                              {u.id === currentUser.id && <span className="text-xs text-blue-400 font-normal">(Anda)</span>}
                            </div>
                            <div className="text-xs text-slate-400 font-mono">@{u.username}</div>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                              u.role === 'Administrator' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                              u.role === 'Guru' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                              'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            }`}>
                              {u.role}
                            </span>
                            {u.role === 'Guru' && u.subject && (
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-950/60 text-emerald-200 border border-emerald-500/30">
                                Mapel: {u.subject}
                              </span>
                            )}
                            {u.role === 'Siswa' && u.student_group && (
                              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                                u.student_group === 'Ikhwan'
                                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                  : 'bg-pink-500/15 text-pink-300 border-pink-500/30'
                              }`}>
                                {u.student_group}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/70">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${u.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                            {u.active ? 'Aktif' : 'Nonaktif'}
                          </span>
                          {u.id !== currentUser.id && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={async () => {
                                  const updated = { ...u, active: !u.active };
                                  const { queuedOffline } = await commitFirestoreWrite(
                                    setDoc(doc(db, 'users', String(u.id)), updated),
                                    OperationType.UPDATE,
                                    `users/${u.id}`
                                  );
                                  addToast('Status Diperbarui', queuedOffline ? `Akun ${u.name} disimpan offline` : `Akun ${u.name} diubah`, 'info');
                                }}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition"
                              >
                                {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
                              <button
                                onClick={() => setDeleteConfirmUser(u)}
                                className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-medium transition inline-flex items-center gap-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Hapus
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Desktop Users Table */}
                <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider bg-slate-900/50">
                        <th className="p-4 font-semibold">Nama &amp; Username</th>
                        <th className="p-4 font-semibold">Peran &amp; Keterangan</th>
                        <th className="p-4 font-semibold">Status</th>
                        <th className="p-4 font-semibold text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-sm">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-slate-500">
                            Belum ada pengguna pada kategori ini.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((u) => (
                          <tr key={u.id} className="hover:bg-slate-800/50 transition">
                            <td className="p-4">
                              <div className="font-semibold text-white">
                                {u.name}{' '}
                                {u.id === currentUser.id && <span className="text-xs text-blue-400 font-normal">(Anda)</span>}
                              </div>
                              <div className="text-xs text-slate-400 font-mono">@{u.username}</div>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                  u.role === 'Administrator' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                                  u.role === 'Guru' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                  'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                }`}>
                                  {u.role}
                                </span>
                                {u.role === 'Guru' && u.subject && (
                                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/60 text-emerald-200 border border-emerald-500/30">
                                    Mapel: {u.subject}
                                  </span>
                                )}
                                {u.role === 'Siswa' && u.student_group && (
                                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                                    u.student_group === 'Ikhwan'
                                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                      : 'bg-pink-500/15 text-pink-300 border-pink-500/30'
                                  }`}>
                                    {u.student_group}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-4">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${u.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                                {u.active ? 'Aktif' : 'Nonaktif'}
                              </span>
                            </td>
                            <td className="p-4 text-right space-x-2 whitespace-nowrap">
                              {u.id !== currentUser.id && (
                                <>
                                  <button
                                    onClick={async () => {
                                      const updated = { ...u, active: !u.active };
                                      const { queuedOffline } = await commitFirestoreWrite(
                                        setDoc(doc(db, 'users', String(u.id)), updated),
                                        OperationType.UPDATE,
                                        `users/${u.id}`
                                      );
                                      addToast('Status Diperbarui', queuedOffline ? `Akun ${u.name} disimpan offline` : `Akun ${u.name} diubah`, 'info');
                                    }}
                                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition"
                                  >
                                    {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmUser(u)}
                                    className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-medium transition inline-flex items-center gap-1"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" /> Hapus
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* TAB 6: NOTIFIKASI */}
          {activeTab === 'notifikasi' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 sm:p-6 rounded-2xl">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white">Pusat Notifikasi</h2>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">Riwayat pemberitahuan tugas baru, pengingat, dan hasil verifikasi.</p>
                </div>
                <button
                  onClick={async () => {
                    const unread = notifications.filter((item) => item.user_id === currentUser.id && !item.is_read);
                    for (const n of unread) {
                      await commitFirestoreWrite(
                        setDoc(doc(db, 'notifications', String(n.id)), { ...n, is_read: true }),
                        OperationType.UPDATE,
                        `notifications/${n.id}`
                      );
                    }
                    addToast('Notifikasi', 'Semua notifikasi ditandai dibaca.', 'success');
                  }}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition"
                >
                  <CheckCheck className="w-4 h-4" />
                  <span>Tandai Semua Dibaca</span>
                </button>
              </div>

              <div className="space-y-3">
                {notifications.filter((n) => n.user_id === currentUser.id).length === 0 ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-500">
                    Tidak ada notifikasi saat ini.
                  </div>
                ) : (
                  notifications
                    .filter((n) => n.user_id === currentUser.id)
                    .map((n) => (
                      <div
                        key={n.id}
                        className={`bg-slate-900 border rounded-2xl p-4 sm:p-5 flex items-start gap-3 sm:gap-4 transition ${
                          n.is_read ? 'border-slate-800/60 opacity-80' : 'border-blue-500/40 bg-slate-900/90 shadow-lg shadow-blue-500/5'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          n.type === 'revisi' ? 'bg-rose-500/20 text-rose-400' :
                          n.type === 'terverifikasi' ? 'bg-emerald-500/20 text-emerald-400' :
                          'bg-blue-500/20 text-blue-400'
                        }`}>
                          <Bell className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2">
                            <div className="font-bold text-white text-sm">{n.title}</div>
                            <div className="text-xs text-slate-500">{formatWib(n.created_at)}</div>
                          </div>
                          <p className="text-sm text-slate-300 mt-1">{n.message}</p>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav
        aria-label="Navigasi Cepat Mobile"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 flex items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]"
      >
        {bottomNavTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex-1 min-h-[56px] py-1.5 px-1 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
                isActive ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                {renderNavIcon(tab.id)}
                {tab.id === 'notifikasi' && unreadNotifsCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[10px] min-w-[16px] h-4 px-1 rounded-full font-bold flex items-center justify-center">
                    {unreadNotifsCount}
                  </span>
                )}
              </div>
              <span className="truncate max-w-full">{tab.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* --- MODALS --- */}

      {/* 1. Modal Kumpulkan Bukti (Siswa) */}
      {submitModalTask && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Kumpulkan Bukti Tugas</h3>
              <button aria-label="Tutup" onClick={() => setSubmitModalTask(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <div className="font-semibold text-white">{submitModalTask.title}</div>
              <div className="text-xs text-slate-400 mt-1">Tenggat: {formatWib(submitModalTask.deadline)}</div>
            </div>

            <SubmissionUploadBox
              assignmentId={submitModalTask.id}
              deadline={submitModalTask.deadline}
              studentId={currentUser.id}
              onSuccess={() => {
                setSubmitModalTask(null);
              }}
              onSubmitted={async (newSub) => {
                const { queuedOffline } = await commitFirestoreWrite(
                  setDoc(doc(db, 'submissions', String(newSub.id)), newSub),
                  OperationType.CREATE,
                  `submissions/${newSub.id}`
                );
                // Notify teachers
                const teachers = users.filter((u) => u.role === 'Guru' || u.role === 'Administrator');
                for (const t of teachers) {
                  await notifyUser(t.id, 'pengumpulan', `Pengumpulan Baru: ${currentUser.name}`, `${submitModalTask.title} ${newSub.is_late ? '(Terlambat)' : ''}`, submitModalTask.id);
                }
                addToast(
                  queuedOffline ? 'Tersimpan Offline' : 'Tugas Dikumpulkan',
                  queuedOffline
                    ? 'Bukti foto disimpan di perangkat dan akan tersinkronisasi saat online.'
                    : newSub.is_late
                    ? 'Tercatat terlambat di sistem.'
                    : 'Menunggu verifikasi guru.',
                  newSub.is_late || queuedOffline ? 'warning' : 'success'
                );
              }}
            />
          </div>
        </div>
      )}

      {/* 2. Modal Lihat Hasil (Siswa) */}
      {viewResultSub && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Hasil Pengumpulan Tugas</h3>
              <button aria-label="Tutup" onClick={() => setViewResultSub(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-white">{viewResultSub.assignment.title}</span>
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${
                  viewResultSub.submission.status === 'Selesai' ? 'bg-emerald-500/20 text-emerald-300' :
                  viewResultSub.submission.status === 'Revisi' ? 'bg-rose-500/20 text-rose-300' :
                  'bg-amber-500/20 text-amber-300'
                }`}>
                  {viewResultSub.submission.status}
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Dikumpulkan: {formatWib(viewResultSub.submission.submitted_at)} {viewResultSub.submission.is_late && '• Terlambat'}
              </div>

              <div className="h-56 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex items-center justify-center">
                <img src={viewResultSub.submission.photo_data} alt="Bukti" className="max-h-full max-w-full object-contain" />
              </div>

              {viewResultSub.submission.note && (
                <div className="text-sm bg-slate-950/50 p-3 rounded-xl border border-slate-800">
                  <strong className="text-white">Catatan Anda:</strong> {viewResultSub.submission.note}
                </div>
              )}
              {viewResultSub.submission.feedback && (
                <div className="text-sm bg-amber-950/30 text-amber-200 p-3 rounded-xl border border-amber-500/30">
                  <strong className="text-white">Catatan Guru:</strong> {viewResultSub.submission.feedback}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setViewResultSub(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Modal Tugas Edit / Baru (Guru) */}
      {editTaskModalData !== null && (
        <AssignmentEditModal
          task={editTaskModalData === 'new' ? null : editTaskModalData}
          defaultSubject={currentUser.role === 'Guru' ? currentUser.subject || '' : ''}
          onClose={() => setEditTaskModalData(null)}
          onSave={async (payload) => {
            if (editTaskModalData === 'new') {
              const newAsg: Assignment = {
                id: Date.now(),
                title: payload.title,
                subject: payload.subject,
                description: payload.description,
                deadline: payload.deadline,
                status: payload.status,
                created_by: currentUser.id,
                created_at: new Date().toISOString()
              };
              const { queuedOffline } = await commitFirestoreWrite(
                setDoc(doc(db, 'assignments', String(newAsg.id)), newAsg),
                OperationType.CREATE,
                `assignments/${newAsg.id}`
              );
              // Notify students
              const students = users.filter((u) => u.role === 'Siswa');
              for (const st of students) {
                await notifyUser(st.id, 'tugas_baru', `Tugas Baru: ${newAsg.title}`, `Tenggat: ${formatWib(newAsg.deadline)}`, newAsg.id);
              }
              addToast(
                queuedOffline ? 'Tugas Disimpan Offline' : 'Tugas Dibuat',
                queuedOffline ? `${newAsg.title} akan tersinkronisasi saat online.` : newAsg.title,
                queuedOffline ? 'warning' : 'success'
              );
            } else {
              const target = editTaskModalData as Assignment;
              const updated = { ...target, ...payload };
              const { queuedOffline } = await commitFirestoreWrite(
                setDoc(doc(db, 'assignments', String(target.id)), updated),
                OperationType.UPDATE,
                `assignments/${target.id}`
              );
              addToast(
                queuedOffline ? 'Perubahan Disimpan Offline' : 'Tugas Diperbarui',
                payload.title,
                queuedOffline ? 'warning' : 'success'
              );
            }
            setEditTaskModalData(null);
          }}
        />
      )}

      {/* 4. Modal Tambah Pengguna (Admin) */}
      {addUserOpen && (
        <AddUserModal
          existingUsernames={users.map((u) => u.username.toLowerCase())}
          onClose={() => setAddUserOpen(false)}
          onAdd={async (newUser) => {
            const { queuedOffline } = await commitFirestoreWrite(
              setDoc(doc(db, 'users', String(newUser.id)), newUser),
              OperationType.CREATE,
              `users/${newUser.id}`
            );
            setAddUserOpen(false);
            const detailSuffix =
              newUser.role === 'Guru' && newUser.subject
                ? ` • Mapel: ${newUser.subject}`
                : newUser.role === 'Siswa' && newUser.student_group
                ? ` • ${newUser.student_group}`
                : '';
            addToast(
              queuedOffline ? 'Pengguna Disimpan Offline' : 'Pengguna Ditambahkan',
              `${newUser.name} (@${newUser.username}${detailSuffix})`,
              queuedOffline ? 'warning' : 'success'
            );
          }}
        />
      )}

      {/* 4b. Modal Bulk Import Users (Admin) */}
      {bulkImportOpen && (
        <BulkImportUsersModal
          existingUsernames={users.map((u) => u.username.toLowerCase())}
          onClose={() => setBulkImportOpen(false)}
          onImport={async (importedUsers) => {
            const CHUNK_SIZE = 450;
            let anyOffline = false;
            for (let i = 0; i < importedUsers.length; i += CHUNK_SIZE) {
              const chunk = importedUsers.slice(i, i + CHUNK_SIZE);
              const batch = writeBatch(db);
              for (const u of chunk) {
                batch.set(doc(db, 'users', String(u.id)), u);
              }
              const { queuedOffline } = await commitFirestoreWrite(batch.commit(), OperationType.WRITE, 'users');
              if (queuedOffline) anyOffline = true;
            }
            setBulkImportOpen(false);
            addToast(
              anyOffline ? 'Impor Disimpan Offline' : 'Impor Pengguna Berhasil',
              anyOffline
                ? `${importedUsers.length} pengguna disimpan di antrean offline dan akan tersinkronisasi saat online.`
                : `${importedUsers.length} pengguna berhasil ditambahkan ke Firestore.`,
              anyOffline ? 'warning' : 'success'
            );
          }}
        />
      )}

      {/* 7. Modal Konfirmasi Hapus Pengguna */}
      {deleteConfirmUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Hapus Pengguna</h3>
              <button aria-label="Tutup" onClick={() => setDeleteConfirmUser(null)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-slate-300">
              Apakah Anda yakin ingin menghapus akun <strong className="text-white">{deleteConfirmUser.name}</strong> (@{deleteConfirmUser.username})?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirmUser(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  await commitFirestoreWrite(
                    deleteDoc(doc(db, 'users', String(deleteConfirmUser.id))),
                    OperationType.DELETE,
                    `users/${deleteConfirmUser.id}`
                  );
                  addToast('Pengguna Dihapus', deleteConfirmUser.name, 'info');
                  setDeleteConfirmUser(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-semibold transition"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Modal Konfirmasi Kosongkan Semua Data */}
      {resetDataConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertCircle className="w-5 h-5" />
                <h3 className="text-lg font-bold text-white">Kosongkan Semua Data</h3>
              </div>
              <button aria-label="Tutup" onClick={() => setResetDataConfirmOpen(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              Tindakan ini akan menghapus seluruh pengguna, tugas, pengumpulan, dan notifikasi di database Firestore, lalu mengembalikan aplikasi ke halaman pendaftaran Admin pertama.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setResetDataConfirmOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  await clearAllFirestoreData();
                  setResetDataConfirmOpen(false);
                  setAuthError('');
                  setCurrentUser(null);
                  addToast('Data Dikosongkan', 'Silakan daftar ulang akun Admin utama.', 'info');
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-semibold transition"
              >
                Ya, Kosongkan Semua
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Modal Konfirmasi Hapus Tugas */}
      {deleteConfirmTask && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Hapus Tugas</h3>
              <button aria-label="Tutup" onClick={() => setDeleteConfirmTask(null)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-slate-300">
              Apakah Anda yakin ingin menghapus tugas <strong className="text-white">"{deleteConfirmTask.title}"</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirmTask(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  await commitFirestoreWrite(
                    deleteDoc(doc(db, 'assignments', String(deleteConfirmTask.id))),
                    OperationType.DELETE,
                    `assignments/${deleteConfirmTask.id}`
                  );
                  addToast('Tugas Dihapus', deleteConfirmTask.title, 'info');
                  setDeleteConfirmTask(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-semibold transition"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Modal Konfirmasi Verifikasi Tugas */}
      {verifyConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="verify-confirm-title"
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <AlertCircle className={`w-5 h-5 ${verifyConfirmModal.decision === 'Selesai' ? 'text-emerald-400' : 'text-rose-400'}`} />
                <h3 id="verify-confirm-title" className="text-lg font-bold text-white">
                  {verifyConfirmModal.decision === 'Selesai' ? 'Konfirmasi Persetujuan' : 'Konfirmasi Permintaan Revisi'}
                </h3>
              </div>
              <button
                aria-label="Tutup"
                disabled={isSubmittingVerify}
                onClick={() => setVerifyConfirmModal(null)}
                className="text-slate-400 hover:text-white disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm text-slate-300">
              <p>
                {verifyConfirmModal.decision === 'Selesai'
                  ? 'Periksa kembali detail pengumpulan sebelum menyetujui tugas berikut:'
                  : 'Periksa kembali detail pengumpulan dan catatan sebelum meminta revisi:'}
              </p>
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400">Siswa:</span>{' '}
                  <strong className="text-white">{verifyConfirmModal.student.name}</strong>
                  {verifyConfirmModal.student.student_group && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        verifyConfirmModal.student.student_group === 'Ikhwan'
                          ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                          : 'bg-pink-500/15 text-pink-300 border-pink-500/30'
                      }`}
                    >
                      {verifyConfirmModal.student.student_group}
                    </span>
                  )}
                </div>
                <div><span className="text-slate-400">Tugas:</span> <strong className="text-white">{verifyConfirmModal.assignment.title}</strong></div>
                <div>
                  <span className="text-slate-400">Waktu Kumpul:</span>{' '}
                  <span className="text-slate-200">{formatWib(verifyConfirmModal.submission.submitted_at)}</span>{' '}
                  <span className={verifyConfirmModal.submission.is_late ? 'text-rose-400 font-medium' : 'text-emerald-400'}>
                    ({verifyConfirmModal.submission.is_late ? 'Terlambat' : 'Tepat waktu'})
                  </span>
                </div>
                {verifyConfirmModal.submission.note && (
                  <div>
                    <span className="text-slate-400">Catatan Siswa:</span>{' '}
                    <span className="text-slate-200">{verifyConfirmModal.submission.note}</span>
                  </div>
                )}
                <div>
                  <span className="text-slate-400">Keputusan:</span>{' '}
                  <span className={`font-semibold ${verifyConfirmModal.decision === 'Selesai' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {verifyConfirmModal.decision === 'Selesai' ? 'Setujui (Selesai)' : 'Minta Revisi'}
                  </span>
                </div>
                <div className="pt-1.5 border-t border-slate-800/80">
                  <span className="text-slate-400 block text-xs mb-0.5">Umpan Balik Guru:</span>
                  {verifyConfirmModal.feedback.trim() ? (
                    <span className="text-slate-100 whitespace-pre-wrap">{verifyConfirmModal.feedback.trim()}</span>
                  ) : (
                    <span className="text-slate-500 italic">(Tidak ada catatan tambahan)</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                disabled={isSubmittingVerify}
                onClick={() => setVerifyConfirmModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition"
              >
                Batal
              </button>
              <button
                disabled={isSubmittingVerify}
                onClick={async () => {
                  const { submission, assignment, student, decision, feedback } = verifyConfirmModal;
                  const result = buildVerificationUpdate({
                    submission,
                    assignmentTitle: assignment.title,
                    decision,
                    feedback,
                    reviewerId: currentUser.id,
                  });
                  if (!result.ok) {
                    addToast('Catatan Diperlukan', result.error, 'warning');
                    setVerifyConfirmModal(null);
                    return;
                  }

                  setIsSubmittingVerify(true);
                  try {
                    const { queuedOffline } = await commitFirestoreWrite(
                      setDoc(doc(db, 'submissions', String(submission.id)), result.updatedSubmission),
                      OperationType.UPDATE,
                      `submissions/${submission.id}`
                    );
                    await notifyUser(
                      submission.student_id,
                      result.notification.type,
                      result.notification.title,
                      result.notification.message,
                      assignment.id
                    );
                    if (decision === 'Selesai') {
                      addToast(
                        queuedOffline ? 'Disetujui (Offline)' : 'Tugas Disetujui',
                        `Pengumpulan ${student.name} dinyatakan Selesai${queuedOffline ? ' (antrean sinkronisasi)' : ''}`,
                        queuedOffline ? 'warning' : 'success'
                      );
                    } else {
                      addToast('Revisi Dikirim', `Meminta revisi untuk ${student.name}`, 'warning');
                    }
                    setVerifyConfirmModal(null);
                  } catch {
                    addToast('Gagal Menyimpan', 'Terjadi kesalahan saat menyimpan keputusan verifikasi.', 'danger');
                  } finally {
                    setIsSubmittingVerify(false);
                  }
                }}
                className={`px-4 py-2 text-white rounded-xl text-sm font-semibold transition flex items-center gap-2 disabled:opacity-60 ${
                  verifyConfirmModal.decision === 'Selesai'
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/20'
                    : 'bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/20'
                }`}
              >
                {verifyConfirmModal.decision === 'Selesai' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isSubmittingVerify ? 'Menyimpan...' : 'Ya, Setujui'}</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    <span>{isSubmittingVerify ? 'Mengirim...' : 'Ya, Minta Revisi'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- SUB-COMPONENT: SUBMISSION UPLOAD BOX ---
function SubmissionUploadBox({ assignmentId, deadline, studentId, onSubmitted, onSuccess }: { assignmentId: number; deadline: string; studentId: number; onSubmitted: (sub: Submission) => Promise<void> | void; onSuccess: () => void }) {
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      const bitmap = await createImageBitmap(file);
      let { width, height } = bitmap;
      const maxDim = 1600;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setPhotoDataUrl(dataUrl);
    } catch {
      setUploadError('Gagal membaca gambar. Pastikan file berupa gambar JPG, PNG, atau WebP yang valid.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3">
        <label className="flex-1 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer transition">
          <Camera className="w-4 h-4 shrink-0" /> Ambil Foto (Kamera)
          <input type="file" accept="image/*" capture="environment" onChange={handleFile} hidden />
        </label>
        <label className="flex-1 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer transition">
          <ImageIcon className="w-4 h-4 shrink-0" /> Pilih dari Galeri
          <input type="file" accept="image/*" onChange={handleFile} hidden />
        </label>
      </div>

      <div className="h-44 sm:h-48 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-center overflow-hidden text-slate-500 text-xs">
        {photoDataUrl ? (
          <img src={photoDataUrl} alt="Preview" className="max-h-full max-w-full object-contain" />
        ) : (
          'Belum ada foto dipilih'
        )}
      </div>

      {uploadError && (
        <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-500/30 rounded-xl px-3 py-2">
          {uploadError}
        </div>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Catatan untuk guru (opsional)..."
        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500 h-20 resize-none"
      />

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onSuccess}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition"
        >
          Batal
        </button>
        <button
          disabled={!photoDataUrl}
          onClick={async () => {
            if (!photoDataUrl) return;
            const now = new Date();
            let sha256 = 'sha256_' + Math.random().toString(36).substring(2);
            try {
              const encoded = new TextEncoder().encode(photoDataUrl);
              const digest = await crypto.subtle.digest('SHA-256', encoded);
              sha256 = Array.from(new Uint8Array(digest))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
            } catch {
              // fallback if crypto.subtle unavailable
            }
            const sub: Submission = {
              id: Date.now(),
              assignment_id: assignmentId,
              student_id: studentId,
              photo_data: photoDataUrl,
              photo_sha256: sha256,
              note,
              submitted_at: now.toISOString(),
              is_late: now.getTime() > new Date(deadline).getTime(),
              status: 'Menunggu',
              revision_count: 0,
              feedback: ''
            };
            await onSubmitted(sub);
            onSuccess();
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-blue-600/30"
        >
          <Send className="w-4 h-4" /> Kirim Bukti
        </button>
      </div>
    </div>
  );
}

// --- SUB-COMPONENT: ASSIGNMENT EDIT MODAL ---
function AssignmentEditModal({
  task,
  defaultSubject = '',
  onClose,
  onSave,
}: {
  task: Assignment | null;
  defaultSubject?: string;
  onClose: () => void;
  onSave: (payload: any) => void;
}) {
  const [title, setTitle] = useState(task?.title || '');
  const [subject, setSubject] = useState(task?.subject || defaultSubject);
  const [description, setDescription] = useState(task?.description || '');
  const [status, setStatus] = useState<'Aktif' | 'Ditutup'>(task?.status || 'Aktif');

  const defaultDate = task ? new Date(task.deadline).toISOString().split('T')[0] : new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const defaultTime = task ? new Date(task.deadline).toTimeString().substring(0, 5) : '23:59';

  const [dateStr, setDateStr] = useState(defaultDate);
  const [timeStr, setTimeStr] = useState(defaultTime);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-lg font-bold text-white">{task ? 'Ubah Tugas' : 'Buat Tugas Baru'}</h3>
          <button aria-label="Tutup" onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="task-title" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Judul Tugas</label>
            <input
              id="task-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500"
              required
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="task-subject" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Mata Pelajaran</label>
              <input
                id="task-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="task-status" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Status</label>
              <select
                id="task-status"
                value={status}
                onChange={(e: any) => setStatus(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500"
              >
                <option value="Aktif">Aktif</option>
                <option value="Ditutup">Ditutup</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="task-date" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Tanggal Tenggat</label>
              <input
                id="task-date"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500 [color-scheme:dark]"
              />
            </div>
            <div>
              <label htmlFor="task-time" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Jam Tenggat (WIB)</label>
              <input
                id="task-time"
                type="time"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500 [color-scheme:dark]"
              />
            </div>
          </div>
          <div>
            <label htmlFor="task-desc" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Instruksi</label>
            <textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500 h-28 resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition">Batal</button>
          <button
            onClick={() => {
              if (!title.trim()) return;
              const deadline = new Date(`${dateStr}T${timeStr}:00+07:00`).toISOString();
              onSave({ title, subject, description, status, deadline });
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-blue-600/30"
          >
            <Save className="w-4 h-4" /> Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

// --- SUB-COMPONENT: ADD USER MODAL ---
function AddUserModal({
  existingUsernames,
  onClose,
  onAdd
}: {
  existingUsernames: string[];
  onClose: () => void;
  onAdd: (u: User) => void;
}) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'Siswa' | 'Guru' | 'Administrator'>('Siswa');
  const [subject, setSubject] = useState('');
  const [studentGroup, setStudentGroup] = useState<'' | StudentGroup>('');
  const [formError, setFormError] = useState('');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-user-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 id="add-user-modal-title" className="text-lg font-bold text-white">Tambah Pengguna</h3>
          <button aria-label="Tutup" onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {formError && (
          <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label htmlFor="add-user-name" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Nama Lengkap</label>
            <input
              id="add-user-name"
              type="text"
              placeholder="Contoh: Budi Santoso"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label htmlFor="add-user-username" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Username</label>
            <input
              id="add-user-username"
              type="text"
              placeholder="Contoh: budi_siswa"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label htmlFor="add-user-password" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Kata Sandi</label>
            <input
              id="add-user-password"
              type="text"
              placeholder="Minimal 4 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label htmlFor="add-user-role" className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Peran</label>
            <select
              id="add-user-role"
              value={role}
              onChange={(e) => {
                const nextRole = e.target.value as 'Siswa' | 'Guru' | 'Administrator';
                setRole(nextRole);
                setFormError('');
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-blue-500"
            >
              <option value="Siswa">Siswa</option>
              <option value="Guru">Guru</option>
              <option value="Administrator">Administrator</option>
            </select>
          </div>

          {role === 'Guru' && (
            <div>
              <label htmlFor="add-user-subject" className="text-xs font-semibold text-emerald-300 uppercase tracking-wider mb-1 block">
                Mata Pelajaran (Guru)
              </label>
              <input
                id="add-user-subject"
                type="text"
                maxLength={100}
                placeholder="Contoh: Matematika, IPA, Tahfidz"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-slate-950 border border-emerald-500/40 rounded-xl p-3 text-sm text-white outline-none focus:border-emerald-400"
                required
              />
            </div>
          )}

          {role === 'Siswa' && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-blue-300 uppercase tracking-wider">
                Kategori Siswa (Ikhwan / Akhwat)
              </div>
              <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Pilih Kategori Siswa">
                <button
                  type="button"
                  aria-pressed={studentGroup === 'Ikhwan'}
                  onClick={() => {
                    setStudentGroup('Ikhwan');
                    setFormError('');
                  }}
                  className={`p-3 rounded-xl border text-sm font-semibold transition flex items-center justify-center gap-2 ${
                    studentGroup === 'Ikhwan'
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-sm shadow-cyan-500/20'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <span>Ikhwan</span>
                </button>
                <button
                  type="button"
                  aria-pressed={studentGroup === 'Akhwat'}
                  onClick={() => {
                    setStudentGroup('Akhwat');
                    setFormError('');
                  }}
                  className={`p-3 rounded-xl border text-sm font-semibold transition flex items-center justify-center gap-2 ${
                    studentGroup === 'Akhwat'
                      ? 'bg-pink-500/20 border-pink-400 text-pink-200 shadow-sm shadow-pink-500/20'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <span>Akhwat</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Sekolah memisahkan rombongan belajar antara siswa Ikhwan dan Akhwat.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition">Batal</button>
          <button
            onClick={() => {
              setFormError('');
              const validation = validateUserRegistration({
                name,
                username,
                password,
                existingUsernames,
              });
              if (!validation.valid) {
                setFormError(validation.error);
                return;
              }
              const roleValidation = validateRoleSpecificUserFields({
                role,
                subject,
                studentGroup,
              });
              if (!roleValidation.valid) {
                setFormError(roleValidation.error);
                return;
              }
              onAdd({
                id: Date.now(),
                name: validation.cleanName,
                username: validation.cleanUsername,
                role,
                active: true,
                password,
                ...(roleValidation.cleanSubject ? { subject: roleValidation.cleanSubject } : {}),
                ...(roleValidation.studentGroup ? { student_group: roleValidation.studentGroup } : {}),
              });
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition shadow-lg shadow-blue-600/30"
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
