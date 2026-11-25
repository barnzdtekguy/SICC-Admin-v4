import { useState } from 'react';
import { Download } from 'lucide-react';
import { promptInstall } from '../../lib/pwa';
import { Btn } from './UI';

function InstallInstructions() {
  const { userAgent, maxTouchPoints } = navigator;
  const isAppleMobile = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

  if (isAppleMobile) return <p>Open this page in Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. If shown, turn on <strong>Open as Web App</strong> and tap <strong>Add</strong>.</p>;
  if (/Android/.test(userAgent)) return <p>Open your browser menu, then tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>;
  if (/Macintosh.*Version\/.*Safari\//.test(userAgent)) return <p>In Safari, choose <strong>File</strong>, then <strong>Add to Dock</strong>.</p>;
  return <p>Look for <strong>Install app</strong> in your browser menu or an install icon in the address bar. If you don’t see either option, open this page in Chrome or Edge.</p>;
}

export default function InstallApp({ nativeAvailable, onClose }) {
  const [installing, setInstalling] = useState(false);
  const canPrompt = nativeAvailable || installing;

  async function install() {
    setInstalling(true);
    try {
      const choice = await promptInstall();
      if (choice !== null) onClose();
    } catch {
      // The browser may reject a native request. The manual steps stay available.
    } finally {
      setInstalling(false);
    }
  }

  return (
    <>
      <div className="app-install-copy">
        <img src="/icons/icon-192.png" width="44" height="44" alt="" />
        <div>
          <p>Open SICC Admin directly from your home screen or app menu.</p>
          {canPrompt ? <p>Choose <strong>Install app</strong> and confirm in your browser.</p> : <InstallInstructions />}
        </div>
      </div>
      <div className="app-install-actions">
        <Btn variant="outline" onClick={onClose}>Not now</Btn>
        {canPrompt && <Btn onClick={install} loading={installing}><Download size={16} aria-hidden="true" /> Install app</Btn>}
      </div>
    </>
  );
}
