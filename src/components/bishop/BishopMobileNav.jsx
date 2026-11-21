import { useState } from 'react';
import { BarChart2, ChevronRight, Home, MoreHorizontal, QrCode, Search, Users } from 'lucide-react';
import { Modal } from '../shared/UI';

const primaryPages = [
  { key: 'overview', label: 'Home', Icon: Home },
  { key: 'members', label: 'Members', Icon: Users },
  { key: 'programmes', label: 'Programme attendance', Icon: QrCode },
  { key: 'reports', label: 'Reports', Icon: BarChart2 },
];
const primaryKeys = new Set(primaryPages.map(page => page.key));

export default function BishopMobileNav({ activeTab, pages, icons, onNavigate, onSearch }) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav className="bishop-dock no-print" aria-label="Bishop mobile navigation">
        {primaryPages.map(({ key, label, Icon }) => {
          const center = key === 'programmes';
          return (
            <button key={key} type="button" className={center ? 'bishop-dock-center' : undefined}
              onClick={() => onNavigate(key)} aria-current={activeTab === key ? 'page' : undefined}>
              <Icon size={center ? 27 : 21} aria-hidden="true" />
              <span className={center ? 'sr-only' : undefined}>{label}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
          <MoreHorizontal size={22} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
      {moreOpen && (
        <div className="bishop-more no-print">
          <Modal title="More pages" onClose={() => setMoreOpen(false)}>
            <div className="bishop-more-links">
              <button type="button" onClick={() => { setMoreOpen(false); onSearch(); }}>
                <Search size={20} aria-hidden="true" /><span>Search SICC Admin</span><ChevronRight size={17} aria-hidden="true" />
              </button>
              {pages.filter(page => !primaryKeys.has(page.key)).map(({ key, label }) => {
                const Icon = icons[key];
                return (
                  <button key={key} type="button" aria-current={activeTab === key ? 'page' : undefined}
                    onClick={() => { setMoreOpen(false); onNavigate(key); }}>
                    <Icon size={20} aria-hidden="true" /><span>{label}</span><ChevronRight size={17} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </Modal>
        </div>
      )}
    </>
  );
}
