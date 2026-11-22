import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import '../../styles/floating-card.css';

const phone = '(max-width: 860px)';
const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

export default function FloatingCard({ id, title, triggerRef, onClose, children, footer, mobileSheet = false, width = 380 }) {
  const layer = useRef(null);
  const card = useRef(null);
  const closeButton = useRef(null);
  const touchStart = useRef(null);
  const [mobile, setMobile] = useState(() => window.matchMedia(phone).matches);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const header = trigger?.closest('header');
    const query = window.matchMedia(phone);
    const position = () => {
      if (!trigger || !layer.current) return;
      const box = trigger.getBoundingClientRect();
      const availableWidth = window.innerWidth - 24;
      const cardWidth = Math.min(width, availableWidth);
      const left = Math.max(12, Math.min(box.right - cardWidth, availableWidth + 12 - cardWidth));
      const below = window.innerHeight - box.bottom - 20;
      const above = box.top - 20;
      const upwards = !query.matches && below < Math.min(280, above);
      const top = query.matches && header ? header.getBoundingClientRect().bottom : box.bottom;
      const { style, dataset } = layer.current;
      style.setProperty('--floating-width', `${cardWidth}px`);
      style.setProperty('--floating-left', `${left}px`);
      style.setProperty('--floating-top', `${Math.ceil(top) + 8}px`);
      style.setProperty('--floating-bottom', `${window.innerHeight - box.top + 8}px`);
      style.setProperty('--floating-available', `${Math.max(96, upwards ? above : below)}px`);
      style.setProperty('--floating-arrow', `${Math.max(16, Math.min(cardWidth - 16, box.left + box.width / 2 - left))}px`);
      dataset.upwards = String(upwards);
      setMobile(query.matches);
    };
    position();
    query.addEventListener('change', position);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const observer = header && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(position) : null;
    observer?.observe(header);
    return () => {
      observer?.disconnect();
      query.removeEventListener('change', position);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [triggerRef, width]);

  useEffect(() => {
    const trigger = triggerRef.current;
    closeButton.current?.focus({ preventScroll: true });
    const outside = event => {
      if (!card.current?.contains(event.target) && !trigger?.contains(event.target)) onClose();
    };
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key !== 'Tab') return;
      const items = [...(card.current?.querySelectorAll(focusable) || [])];
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !items.includes(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !items.includes(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onKey);
      if (document.activeElement === document.body) {
        trigger?.focus({ preventScroll: true });
      }
    };
  }, [onClose, triggerRef]);

  return createPortal(
    <div ref={layer} className={`floating-card-layer no-print${mobileSheet ? ' floating-card-sheet' : ''}`}>
      <div className="floating-card-backdrop" aria-hidden="true" />
      <section ref={card} id={id} role="dialog" aria-modal={mobile || undefined} aria-labelledby={`${id}-title`} className="floating-card">
        <div className="floating-card-header"
          onTouchStart={event => { touchStart.current = event.touches[0]?.clientY; }}
          onTouchEnd={event => {
            const start = touchStart.current;
            touchStart.current = null;
            const distance = (event.changedTouches[0]?.clientY ?? start) - start;
            if (mobile && (mobileSheet ? distance : -distance) > 36) onClose();
          }}
          onTouchCancel={() => { touchStart.current = null; }}>
          <h2 id={`${id}-title`}>{title}</h2>
          <button ref={closeButton} type="button" className="floating-card-close" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="floating-card-content">{children}</div>
        {footer && <div className="floating-card-footer">{footer}</div>}
      </section>
    </div>,
    document.body,
  );
}
