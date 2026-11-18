import React, { useState } from 'react';
import { CloudOff, Download, RefreshCw, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC<{ variant?: 'header' | 'auth' }> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [guideOpen, setGuideOpen] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setGuideOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          variant === 'auth'
            ? 'w-full py-2.5 bg-slate-900 hover:bg-slate-700/70 text-slate-200 border border-slate-700 rounded-xl font-medium text-xs transition flex items-center justify-center gap-2'
            : 'flex items-center gap-1.5 sm:gap-2 bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 border border-blue-500/30 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap'
        }
      >
        {isIOS ? <Smartphone className="w-4 h-4 shrink-0" /> : <Download className="w-4 h-4 shrink-0" />}
        <span className={variant === 'header' ? 'hidden xs:inline sm:inline' : ''}>
          {isInstallable ? 'Pasang Aplikasi' : isIOS ? 'Pasang di iOS' : 'Pasang PWA'}
        </span>
      </button>

      {guideOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-blue-400 shrink-0" />
                <h3 className="text-base sm:text-lg font-bold text-white">
                  {isIOS ? 'Pasang di iPhone / iPad' : 'Pasang Aplikasi SIMS Tugas (PWA)'}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => setGuideOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2 text-sm text-slate-300 list-decimal list-inside leading-relaxed">
                <li>
                  Buka aplikasi ini di browser <strong className="text-white">Safari</strong>.
                </li>
                <li>
                  Ketuk tombol <strong className="text-white">Share</strong> (ikon kotak dengan panah ke atas) di bilah Safari.
                </li>
                <li>
                  Gulir ke bawah lalu ketuk <strong className="text-white">Add to Home Screen</strong> (Tambahkan ke Layar Utama).
                </li>
              </ol>
            ) : (
              <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
                <p>
                  Aplikasi ini sudah mendukung <strong className="text-white">Progressive Web App (PWA)</strong> dan dapat diinstal ke perangkat desktop maupun Android.
                </p>
                <ol className="space-y-1.5 list-decimal list-inside text-xs text-slate-300">
                  <li>Buka alamat aplikasi secara langsung di tab browser Chrome, Edge, atau Android Chrome (di luar frame pratinjau).</li>
                  <li>Klik ikon <strong className="text-white">Install / Pasang SIMS Tugas</strong> di bilah alamat browser atau pilih menu browser → <strong className="text-white">Install app / Tambahkan ke layar utama</strong>.</li>
                </ol>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC<{ hasPendingSync?: boolean }> = ({ hasPendingSync = false }) => {
  const isOnline = useOnlineStatus();

  if (isOnline && !hasPendingSync) return null;

  return (
    <div
      role="status"
      className={`fixed bottom-20 md:bottom-4 left-4 right-4 sm:right-auto z-40 flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-white shadow-lg border ${
        !isOnline
          ? 'bg-amber-600 border-amber-400/40'
          : 'bg-blue-600 border-blue-400/40'
      }`}
    >
      {!isOnline ? (
        <>
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            Mode Offline — Data tersimpan tetap dapat dibuka{hasPendingSync ? ' & antrean perubahan menunggu koneksi.' : ' dan diubah.'}
          </span>
        </>
      ) : (
        <>
          <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />
          <span>Menyinkronkan perubahan offline ke Cloud Firestore...</span>
        </>
      )}
    </div>
  );
};

export const OfflineBadge: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-semibold whitespace-nowrap">
      <CloudOff className="w-3 h-3 shrink-0" />
      <span>Offline</span>
    </span>
  );
};

