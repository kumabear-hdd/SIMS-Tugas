export type StudentGroup = 'Ikhwan' | 'Akhwat';

export interface SimsUser {
  id: number;
  username: string;
  name: string;
  role: 'Siswa' | 'Guru' | 'Administrator';
  active: boolean;
  password?: string;
  subject?: string;
  student_group?: StudentGroup;
}

export interface SimsAssignment {
  id: number;
  title: string;
  subject: string;
  description: string;
  deadline: string;
  status: 'Aktif' | 'Ditutup';
  created_by: number;
  created_at: string;
}

export interface SimsSubmission {
  id: number;
  assignment_id: number;
  student_id: number;
  photo_data: string;
  photo_sha256: string;
  note: string;
  submitted_at: string;
  is_late: boolean;
  status: 'Menunggu' | 'Revisi' | 'Selesai';
  revision_count: number;
  feedback: string;
  reviewed_by?: number;
  reviewed_at?: string;
}

export interface TaskProgress {
  submittedCount: number;
  totalStudents: number;
  progressPercent: number;
}

export function calculateAssignmentProgress(
  assignmentId: number,
  users: SimsUser[],
  submissions: SimsSubmission[]
): TaskProgress {
  const activeStudents = users.filter((u) => u.role === 'Siswa' && u.active);
  const totalStudents = activeStudents.length;
  const activeStudentIds = new Set(activeStudents.map((u) => u.id));

  const submittedCount = new Set(
    submissions
      .filter((s) => s.assignment_id === assignmentId && activeStudentIds.has(s.student_id))
      .map((s) => s.student_id)
  ).size;

  const progressPercent = totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0;

  return {
    submittedCount,
    totalStudents,
    progressPercent,
  };
}

export function validateUserRegistration(params: {
  name: string;
  username: string;
  password: string;
  confirmPassword?: string;
  requireConfirm?: boolean;
  existingUsernames?: string[];
}): { valid: true; cleanName: string; cleanUsername: string } | { valid: false; error: string } {
  const cleanName = params.name.trim();
  const cleanUsername = params.username.trim().toLowerCase();

  if (!cleanName || !cleanUsername) {
    return { valid: false, error: 'Nama lengkap dan username wajib diisi.' };
  }
  if (/\s/.test(cleanUsername)) {
    return { valid: false, error: 'Username tidak boleh mengandung spasi.' };
  }
  if (params.existingUsernames && params.existingUsernames.includes(cleanUsername)) {
    return { valid: false, error: `Username "@${cleanUsername}" sudah digunakan.` };
  }
  if (params.password.length < 4) {
    return { valid: false, error: 'Kata sandi minimal 4 karakter.' };
  }
  if (params.requireConfirm && params.password !== (params.confirmPassword ?? '')) {
    return { valid: false, error: 'Konfirmasi kata sandi tidak cocok.' };
  }

  return { valid: true, cleanName, cleanUsername };
}

export function normalizeStudentGroup(rawGroup: string): StudentGroup | null {
  const normalized = rawGroup.trim().toLowerCase();
  if (normalized === 'ikhwan') return 'Ikhwan';
  if (normalized === 'akhwat') return 'Akhwat';
  return null;
}

export function validateRoleSpecificUserFields(params: {
  role: SimsUser['role'];
  subject?: string;
  studentGroup?: string;
}):
  | { valid: true; cleanSubject?: string; studentGroup?: StudentGroup }
  | { valid: false; error: string } {
  if (params.role === 'Guru') {
    const cleanSubject = (params.subject ?? '').trim();
    if (!cleanSubject) {
      return { valid: false, error: 'Mata pelajaran wajib diisi untuk akun Guru.' };
    }
    if (cleanSubject.length > 100) {
      return { valid: false, error: 'Nama mata pelajaran maksimal 100 karakter.' };
    }
    return { valid: true, cleanSubject };
  }

  if (params.role === 'Siswa') {
    const normalized = normalizeStudentGroup(params.studentGroup ?? '');
    if (!normalized) {
      return { valid: false, error: 'Pilih kategori siswa: Ikhwan atau Akhwat.' };
    }
    return { valid: true, studentGroup: normalized };
  }

  return { valid: true };
}

export function authenticateUser(
  users: SimsUser[],
  username: string,
  password: string
): { ok: true; user: SimsUser } | { ok: false; error: string } {
  const cleanUsername = username.trim().toLowerCase();
  const found = users.find((u) => u.username.toLowerCase() === cleanUsername && u.active);
  if (!found) {
    return { ok: false, error: 'Username tidak ditemukan atau akun dinonaktifkan.' };
  }
  if ((found.password || '') !== password) {
    return { ok: false, error: 'Kata sandi salah.' };
  }
  return { ok: true, user: found };
}

export function formatWibDateTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return (
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(d)
      .replace('.', ':') + ' WIB'
  );
}

export function buildAssignmentsCsvReport(
  assignments: SimsAssignment[],
  users: SimsUser[],
  submissions: SimsSubmission[],
  nowMs: number = Date.now()
): string {
  const students = users.filter((u) => u.role === 'Siswa');
  const escapeCsv = (val: string | number) => `"${String(val ?? '').replace(/"/g, '""')}"`;

  const headers = [
    'ID Tugas',
    'Judul Tugas',
    'Mata Pelajaran',
    'Status Tugas',
    'Tenggat (WIB)',
    'Nama Siswa',
    'Username Siswa',
    'Status Penyelesaian',
    'Ketepatan Waktu',
    'Waktu Kumpul (WIB)',
    'Catatan Siswa',
    'Umpan Balik Guru',
  ];

  const rows: string[] = [headers.map(escapeCsv).join(',')];

  for (const a of assignments) {
    const isPastDeadline = nowMs > new Date(a.deadline).getTime();
    if (students.length === 0) {
      rows.push(
        [
          a.id,
          a.title,
          a.subject,
          a.status,
          formatWibDateTime(a.deadline),
          '-',
          '-',
          'Belum ada siswa',
          '-',
          '-',
          '',
          '',
        ]
          .map(escapeCsv)
          .join(',')
      );
    } else {
      for (const st of students) {
        const sub = submissions.find((s) => s.assignment_id === a.id && s.student_id === st.id);
        const completionStatus = sub
          ? sub.status
          : isPastDeadline
          ? 'Terlambat (Belum kumpul)'
          : 'Belum dikumpulkan';
        const timing = sub ? (sub.is_late ? 'Terlambat' : 'Tepat waktu') : '-';
        rows.push(
          [
            a.id,
            a.title,
            a.subject,
            a.status,
            formatWibDateTime(a.deadline),
            st.name,
            st.username,
            completionStatus,
            timing,
            sub ? formatWibDateTime(sub.submitted_at) : '-',
            sub?.note || '',
            sub?.feedback || '',
          ]
            .map(escapeCsv)
            .join(',')
        );
      }
    }
  }

  return '\uFEFF' + rows.join('\r\n');
}

export function buildVerificationUpdate(params: {
  submission: SimsSubmission;
  assignmentTitle: string;
  decision: 'Selesai' | 'Revisi';
  feedback: string;
  reviewerId: number;
  nowIso?: string;
}):
  | {
      ok: true;
      updatedSubmission: SimsSubmission;
      notification: {
        type: 'terverifikasi' | 'revisi';
        title: string;
        message: string;
      };
    }
  | { ok: false; error: string } {
  const cleanFeedback = params.feedback.trim();
  if (params.decision === 'Revisi' && !cleanFeedback) {
    return { ok: false, error: 'Mohon isi catatan atau alasan revisi terlebih dahulu.' };
  }

  const nowIso = params.nowIso ?? new Date().toISOString();
  const updatedSubmission: SimsSubmission = {
    ...params.submission,
    status: params.decision,
    feedback: cleanFeedback,
    revision_count:
      params.decision === 'Revisi'
        ? params.submission.revision_count + 1
        : params.submission.revision_count,
    reviewed_by: params.reviewerId,
    reviewed_at: nowIso,
  };

  if (params.decision === 'Selesai') {
    return {
      ok: true,
      updatedSubmission,
      notification: {
        type: 'terverifikasi',
        title: `Tugas Disetujui: ${params.assignmentTitle}`,
        message: cleanFeedback || 'Tugas Anda telah diverifikasi dan dinyatakan Selesai.',
      },
    };
  }

  return {
    ok: true,
    updatedSubmission,
    notification: {
      type: 'revisi',
      title: `Perlu Revisi: ${params.assignmentTitle}`,
      message: cleanFeedback,
    },
  };
}

export interface BulkImportRowError {
  rowNumber: number;
  username: string;
  reason: string;
}

export type BulkImportParseResult =
  | {
      ok: false;
      error: string;
    }
  | {
      ok: true;
      validUsers: SimsUser[];
      errors: BulkImportRowError[];
      totalRows: number;
    };

export function parseCsvRows(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '');
  const firstNewline = text.search(/\r?\n/);
  const headerLine = firstNewline === -1 ? text : text.slice(0, firstNewline);
  const delimiter = !headerLine.includes(',') && headerLine.includes(';') ? ';' : ',';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else if (ch === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.trim() !== ''));
}

function normalizeBulkRole(rawRole: string): SimsUser['role'] | null {
  const normalized = rawRole.trim().toLowerCase();
  if (normalized === 'siswa' || normalized === 'student') return 'Siswa';
  if (normalized === 'guru' || normalized === 'teacher') return 'Guru';
  if (normalized === 'administrator' || normalized === 'admin') return 'Administrator';
  return null;
}

export function parseBulkUsersCsv(
  csvText: string,
  existingUsernames: string[],
  baseId: number = Date.now()
): BulkImportParseResult {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    return {
      ok: false,
      error: 'File CSV kosong atau tidak memiliki baris data di bawah header.',
    };
  }

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const findCol = (aliases: string[]) => headers.findIndex((h) => aliases.includes(h));

  const nameIdx = findCol(['name', 'nama', 'nama lengkap']);
  const usernameIdx = findCol(['username', 'user']);
  const passwordIdx = findCol(['password', 'kata sandi', 'sandi']);
  const roleIdx = findCol(['role', 'peran']);
  const subjectIdx = findCol(['subject', 'mapel', 'mata pelajaran']);
  const groupIdx = findCol(['group', 'kategori', 'jenis', 'gender', 'kelas', 'ikhwan/akhwat']);

  if (nameIdx === -1 || usernameIdx === -1 || passwordIdx === -1 || roleIdx === -1) {
    return {
      ok: false,
      error: 'Header CSV wajib memiliki kolom: Name, Username, Password, dan Role.',
    };
  }

  const seenUsernames = new Set(existingUsernames.map((u) => u.trim().toLowerCase()));
  const validUsers: SimsUser[] = [];
  const errors: BulkImportRowError[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;
    const rawName = (row[nameIdx] ?? '').trim();
    const rawUsername = (row[usernameIdx] ?? '').trim();
    const rawPassword = row[passwordIdx] ?? '';
    const rawRole = (row[roleIdx] ?? '').trim();

    const validation = validateUserRegistration({
      name: rawName,
      username: rawUsername,
      password: rawPassword,
      existingUsernames: Array.from(seenUsernames),
    });

    if (!validation.valid) {
      errors.push({
        rowNumber,
        username: rawUsername || '-',
        reason: validation.error,
      });
      continue;
    }

    if (validation.cleanName.length > 100) {
      errors.push({
        rowNumber,
        username: validation.cleanUsername,
        reason: 'Nama lengkap maksimal 100 karakter.',
      });
      continue;
    }
    if (validation.cleanUsername.length > 50) {
      errors.push({
        rowNumber,
        username: validation.cleanUsername,
        reason: 'Username maksimal 50 karakter.',
      });
      continue;
    }
    if (rawPassword.length > 100) {
      errors.push({
        rowNumber,
        username: validation.cleanUsername,
        reason: 'Kata sandi maksimal 100 karakter.',
      });
      continue;
    }

    const mappedRole = normalizeBulkRole(rawRole);
    if (!mappedRole) {
      errors.push({
        rowNumber,
        username: validation.cleanUsername,
        reason: `Peran "${rawRole || '-'}" tidak valid. Gunakan Siswa, Guru, atau Administrator.`,
      });
      continue;
    }

    const rawSubject = subjectIdx !== -1 ? (row[subjectIdx] ?? '').trim() : '';
    const rawGroup = groupIdx !== -1 ? (row[groupIdx] ?? '').trim() : '';

    let cleanSubject: string | undefined;
    let studentGroup: StudentGroup | undefined;

    if (mappedRole === 'Guru' && subjectIdx !== -1) {
      const roleCheck = validateRoleSpecificUserFields({ role: 'Guru', subject: rawSubject });
      if (!roleCheck.valid) {
        errors.push({
          rowNumber,
          username: validation.cleanUsername,
          reason: roleCheck.error,
        });
        continue;
      }
      cleanSubject = roleCheck.cleanSubject;
    }

    if (mappedRole === 'Siswa' && groupIdx !== -1) {
      const roleCheck = validateRoleSpecificUserFields({ role: 'Siswa', studentGroup: rawGroup });
      if (!roleCheck.valid) {
        errors.push({
          rowNumber,
          username: validation.cleanUsername,
          reason: roleCheck.error,
        });
        continue;
      }
      studentGroup = roleCheck.studentGroup;
    }

    seenUsernames.add(validation.cleanUsername);
    validUsers.push({
      id: baseId + validUsers.length + 1,
      name: validation.cleanName,
      username: validation.cleanUsername,
      password: rawPassword,
      role: mappedRole,
      active: true,
      ...(cleanSubject ? { subject: cleanSubject } : {}),
      ...(studentGroup ? { student_group: studentGroup } : {}),
    });
  }

  return {
    ok: true,
    validUsers,
    errors,
    totalRows: rows.length - 1,
  };
}

export function buildBulkUsersTemplateCsv(): string {
  return [
    'Name,Username,Password,Role,Subject,Group',
    '"Budi Santoso",budi_siswa,siswa123,Siswa,,Ikhwan',
    '"Siti Aminah",siti_siswa,siswa123,Siswa,,Akhwat',
    '"Ibu Sari",guru_sari,guru123,Guru,Matematika,',
  ].join('\r\n');
}

export interface AssignmentDaySummary {
  dateKey: string;
  dayLabel: string;
  count: number;
  titles: string[];
}

export interface AssignmentPeriodSummary {
  totalAssignments: number;
  activeDaysCount: number;
  days: AssignmentDaySummary[];
}

export function getWibDateKey(input: string | number | Date): string {
  if (!input && input !== 0) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

export function formatWibDateOnly(isoOrDateKey: string, includeWeekday: boolean = true): string {
  if (!isoOrDateKey) return '-';
  let dateObj: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDateKey)) {
    dateObj = new Date(`${isoOrDateKey}T12:00:00+07:00`);
  } else {
    dateObj = new Date(isoOrDateKey);
  }
  if (isNaN(dateObj.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: includeWeekday ? 'long' : undefined,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(dateObj);
}

export function getWibDatePresets(nowMs: number = Date.now()): {
  today: string;
  last7Start: string;
  monthStart: string;
} {
  const today = getWibDateKey(nowMs);
  const sevenDaysAgoMs = nowMs - 6 * 24 * 60 * 60 * 1000;
  const last7Start = getWibDateKey(sevenDaysAgoMs);
  const monthStart = today ? `${today.slice(0, 7)}-01` : '';
  return { today, last7Start, monthStart };
}

export function filterAssignmentsByDateRange(
  assignments: SimsAssignment[],
  startDate: string,
  endDate: string
): SimsAssignment[] {
  const start = startDate.trim();
  const end = endDate.trim();
  if (start && end && start > end) {
    return [];
  }

  return assignments.filter((a) => {
    const key = getWibDateKey(a.created_at);
    if (!key) return !start && !end;
    if (start && key < start) return false;
    if (end && key > end) return false;
    return true;
  });
}

export function summarizeAssignmentsByDay(assignments: SimsAssignment[]): AssignmentPeriodSummary {
  const grouped = new Map<string, string[]>();

  for (const a of assignments) {
    const key = getWibDateKey(a.created_at);
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(a.title);
    grouped.set(key, list);
  }

  const days: AssignmentDaySummary[] = Array.from(grouped.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, titles]) => ({
      dateKey,
      dayLabel: formatWibDateOnly(dateKey, true),
      count: titles.length,
      titles,
    }));

  return {
    totalAssignments: assignments.length,
    activeDaysCount: days.length,
    days,
  };
}

export interface NavTabDescriptor {
  id: 'tugas-saya' | 'verifikasi' | 'kelola-tugas' | 'cetak-biru' | 'pengguna' | 'notifikasi';
  label: string;
  shortLabel: string;
  showInBottomNav: boolean;
}

export function getNavigationTabsForRole(role: SimsUser['role']): NavTabDescriptor[] {
  if (role === 'Siswa') {
    return [
      { id: 'tugas-saya', label: 'Tugas Saya', shortLabel: 'Tugas', showInBottomNav: true },
      { id: 'notifikasi', label: 'Notifikasi', shortLabel: 'Notif', showInBottomNav: true },
    ];
  }
  if (role === 'Guru') {
    return [
      { id: 'verifikasi', label: 'Dasbor Verifikasi', shortLabel: 'Verifikasi', showInBottomNav: true },
      { id: 'kelola-tugas', label: 'Kelola Tugas', shortLabel: 'Tugas', showInBottomNav: true },
      { id: 'cetak-biru', label: 'Cetak Biru Teknis', shortLabel: 'Cetak Biru', showInBottomNav: false },
      { id: 'notifikasi', label: 'Notifikasi', shortLabel: 'Notif', showInBottomNav: true },
    ];
  }
  return [
    { id: 'verifikasi', label: 'Dasbor Verifikasi', shortLabel: 'Verifikasi', showInBottomNav: true },
    { id: 'kelola-tugas', label: 'Kelola Tugas', shortLabel: 'Tugas', showInBottomNav: true },
    { id: 'pengguna', label: 'Pengguna', shortLabel: 'Pengguna', showInBottomNav: true },
    { id: 'cetak-biru', label: 'Cetak Biru Teknis', shortLabel: 'Cetak Biru', showInBottomNav: false },
    { id: 'notifikasi', label: 'Notifikasi', shortLabel: 'Notif', showInBottomNav: true },
  ];
}

export interface OfflineSnapshotData {
  users: SimsUser[];
  assignments: SimsAssignment[];
  updatedAt: string;
}

export function serializeOfflineSnapshot(data: OfflineSnapshotData): string {
  return JSON.stringify({
    users: Array.isArray(data.users) ? data.users : [],
    assignments: Array.isArray(data.assignments) ? data.assignments : [],
    updatedAt: data.updatedAt || new Date().toISOString(),
  });
}

export function parseOfflineSnapshot(raw: string | null): OfflineSnapshotData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OfflineSnapshotData>;
    if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.assignments)) {
      return null;
    }
    return {
      users: parsed.users,
      assignments: parsed.assignments,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}


