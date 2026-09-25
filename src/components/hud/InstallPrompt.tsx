'use client';

import { useEffect, useState } from 'react';

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
const KEY = 'cs6_install_dismissed';

/** Mounted before boot, but displayed only in the mobile main menu. */
export function InstallPrompt({ visible }: { visible: boolean }) {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(true);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const standalone = matchMedia('(display-mode: standalone)');
    const installed = () => standalone.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
    let dismissed = false;
    try { dismissed = localStorage.getItem(KEY) === '1'; } catch { /* Browser play works without storage. */ }
    setHidden(installed() || dismissed);
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent); };
    const done = () => { setHidden(true); setPrompt(null); };
    const change = () => { if (installed()) done(); };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', done);
    standalone.addEventListener('change', change);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', done);
      standalone.removeEventListener('change', change);
    };
  }, []);
  if (!visible || hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(KEY, '1'); } catch { /* Dismiss for this visit. */ }
  };
  const install = async () => {
    if (!prompt) { setHelp(true); return; }
    setBusy(true);
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === 'accepted') dismiss();
      else setHelp(true);
    } catch { setHelp(true); }
    finally { setPrompt(null); setBusy(false); }
  };
  return <aside className="install-prompt" aria-label="Install game" data-ui-block="" data-ui-input-block="">
    <p>Keep Counter Slop 6 on your home screen. Installation is optional.</p>
    <div className="install-actions">
      <button type="button" className="screen-button" disabled={busy} onClick={install}>{prompt ? 'Install game' : 'How to install'}</button>
      <button type="button" className="screen-button" onClick={dismiss}>Continue in browser</button>
    </div>
    {help && <p role="status">On iPhone: Safari → Share → Add to Home Screen. On Android: Chrome menu → Install app or Add to Home screen. If the option is absent, continue in your browser. An internet connection is required; installation does not keep a background match running.</p>}
  </aside>;
}
