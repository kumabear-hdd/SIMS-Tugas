import React, { useState } from 'react';
import { Upload, Download, AlertCircle, CheckCircle2, FileSpreadsheet, X } from 'lucide-react';
import {
  parseBulkUsersCsv,
  buildBulkUsersTemplateCsv,
  type BulkImportParseResult,
  type SimsUser,
} from '../utils/simsLogic';

interface BulkImportUsersModalProps {
  existingUsernames: string[];
  onClose: () => void;
  onImport: (users: SimsUser[]) => Promise<void>;
}

export const BulkImportUsersModal: React.FC<BulkImportUsersModalProps> = ({
  existingUsernames,
  onClose,
  onImport,
}) => {
  const [fileName, setFileName] = useState<string>('');
  const [parseResult, setParseResult] = useState<BulkImportParseResult | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setSubmitError('');
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const result = parseBulkUsersCsv(text, existingUsernames);
      setParseResult(result);
    } catch {
      setParseResult({ ok: false, error: 'Gagal membaca file CSV. Pastikan file tidak rusak.' });
    }
  };

  const handleDownloadTemplate = () => {
    const csv = '\uFEFF' + buildBulkUsersTemplateCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'template-import-pengguna.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const validUsers = parseResult && parseResult.ok ? parseResult.validUsers : [];
  const rowErrors = parseResult && parseResult.ok ? parseResult.errors : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-import-title"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-blue-400" />
            <h3 id="bulk-import-title" className="text-lg font-bold text-white">
              Bulk Import Users (CSV)
            </h3>
          </div>
          <button
            type="button"
            aria-label="Tutup"
            disabled={isImporting}
            onClick={onClose}
            className="text-slate-400 hover:text-white disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-300 space-y-1">
              <div className="font-semibold text-white">Format Kolom CSV:</div>
              <div className="font-mono text-blue-300">Name, Username, Password, Role, Subject, Group</div>
              <div className="text-slate-400">
                <code className="text-slate-200">Role</code>: Siswa, Guru, Administrator. Isi <code className="text-slate-200">Subject</code> (Mapel) untuk Guru, dan <code className="text-slate-200">Group</code> (Ikhwan / Akhwat) untuk Siswa.
              </div>
            </div>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-2 transition shrink-0 whitespace-nowrap"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Unduh Template CSV</span>
            </button>
          </div>

          <label className="block border-2 border-dashed border-slate-700 hover:border-blue-500/70 bg-slate-950/40 rounded-xl p-6 text-center cursor-pointer transition">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
              aria-label="Pilih file CSV pengguna"
            />
            <Upload className="w-7 h-7 text-blue-400 mx-auto mb-2" />
            <div className="text-sm font-semibold text-white">
              {fileName ? fileName : 'Pilih file CSV dari perangkat Anda'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Klik untuk memilih file <span className="font-mono">.csv</span> (pemisah koma atau titik koma)
            </div>
          </label>

          {submitError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {parseResult && !parseResult.ok && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{parseResult.error}</span>
            </div>
          )}

          {parseResult && parseResult.ok && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs text-emerald-300">Siap Diimpor</div>
                    <div className="text-base font-bold text-white">{validUsers.length} pengguna</div>
                  </div>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-2.5">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <div className="text-xs text-amber-300">Dilewati / Tidak Valid</div>
                    <div className="text-base font-bold text-white">{rowErrors.length} baris</div>
                  </div>
                </div>
              </div>

              {rowErrors.length > 0 && (
                <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-3 space-y-1.5 max-h-32 overflow-y-auto">
                  <div className="text-xs font-semibold text-rose-300">Baris yang dilewati:</div>
                  {rowErrors.map((err, idx) => (
                    <div key={idx} className="text-xs text-rose-200">
                      Baris {err.rowNumber} ({err.username}): {err.reason}
                    </div>
                  ))}
                </div>
              )}

              {validUsers.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-900 text-slate-400 uppercase sticky top-0">
                      <tr>
                        <th className="p-2.5 font-semibold">Nama</th>
                        <th className="p-2.5 font-semibold">Username</th>
                        <th className="p-2.5 font-semibold">Peran &amp; Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {validUsers.map((u) => (
                        <tr key={u.id}>
                          <td className="p-2.5 text-white font-medium">{u.name}</td>
                          <td className="p-2.5 text-slate-300 font-mono">@{u.username}</td>
                          <td className="p-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                  u.role === 'Administrator'
                                    ? 'bg-purple-500/20 text-purple-300'
                                    : u.role === 'Guru'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'bg-blue-500/20 text-blue-300'
                                }`}
                              >
                                {u.role}
                              </span>
                              {u.role === 'Guru' && u.subject && (
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/60 text-emerald-200 border border-emerald-500/30">
                                  Mapel: {u.subject}
                                </span>
                              )}
                              {u.role === 'Siswa' && u.student_group && (
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                                    u.student_group === 'Ikhwan'
                                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                      : 'bg-pink-500/15 text-pink-300 border-pink-500/30'
                                  }`}
                                >
                                  {u.student_group}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-800 shrink-0">
          <button
            type="button"
            disabled={isImporting}
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={isImporting || validUsers.length === 0}
            onClick={async () => {
              if (validUsers.length === 0) return;
              setSubmitError('');
              setIsImporting(true);
              try {
                await onImport(validUsers);
              } catch {
                setSubmitError('Gagal mengimpor pengguna ke Firestore. Coba lagi.');
              } finally {
                setIsImporting(false);
              }
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-blue-600/30"
          >
            <Upload className="w-4 h-4" />
            <span>{isImporting ? 'Mengimpor...' : `Impor ${validUsers.length} Pengguna`}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
