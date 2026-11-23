import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Btn } from './UI';
import '../../styles/welcome-tour.css';

const inset = 12;
const panelWidth = 380;
const gap = 16;
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function positionTour(target, panel, mobile) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const cardWidth = Math.min(panelWidth, width - 2 * inset);
  const cardHeight = panel.offsetHeight;
  const boundLeft = value => clamp(value, inset, width - cardWidth - inset);
  const boundTop = value => clamp(value, inset, height - cardHeight - inset);
  const box = target?.getBoundingClientRect();
  if (!box?.width || !box.height) return {
    card: { left: boundLeft((width - cardWidth) / 2), top: boundTop((height - cardHeight) / 2) },
    spot: null,
  };
  const pad = 4;
  const left = clamp(box.left - pad, 2, width - 2);
  const top = clamp(box.top - pad, 2, height - 2);
  const right = clamp(box.right + pad, left, width - 2);
  const bottom = clamp(box.bottom + pad, top, height - 2);
  const centeredLeft = boundLeft((left + right - cardWidth) / 2);
  let card;
  if (!mobile && right + gap + cardWidth <= width - inset) {
    card = { left: right + gap, top: boundTop((top + bottom - cardHeight) / 2) };
  } else if (bottom + gap + cardHeight <= height - inset || top < height - bottom) {
    card = { left: centeredLeft, top: boundTop(bottom + gap) };
  } else {
    card = { left: centeredLeft, top: boundTop(top - gap - cardHeight) };
  }
  return { card, spot: { top, left, width: right - left, height: bottom - top } };
}

export default function WelcomeTour({ shellRef, steps, mobile, onDismiss }) {
  const [requestedIndex, setIndex] = useState(0);
  const index = Math.min(requestedIndex, steps.length - 1);
  const step = steps[index];
  const final = index === steps.length - 1;
  const [position, setPosition] = useState(null);
  const descriptionId = useId();
  const panelRef = useRef(null);
  const titleRef = useRef(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const previous = document.activeElement;
    const wasInert = shell.inert;
    shell.inert = true;
    return () => {
      shell.inert = wasInert;
      const restore = previous !== document.body && shell.contains(previous) && previous.isConnected ? previous : shell.querySelector('main');
      restore?.focus({ preventScroll: true });
    };
  }, [shellRef]);

  useLayoutEffect(() => {
    const targets = shellRef.current.querySelectorAll(`[data-tour-target="${step.target}"]`);
    const target = Array.from(targets).find(element => element.getClientRects().length);
    const panel = panelRef.current;
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const update = () => setPosition(positionTour(target, panel, mobile));
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(panel);
    if (target) observer?.observe(target);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step.id, step.target, mobile, shellRef]);

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [step.id]);

  const handleKey = event => {
    if (event.key === 'Escape') { event.preventDefault(); onDismiss(); return; }
    if (event.key !== 'Tab') return;
    const controls = panelRef.current.querySelectorAll('button:not([disabled])');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };

  return createPortal(
    <div className="welcome-tour-layer" data-unanchored={!position?.spot || undefined}>
      {position?.spot && <div className="welcome-tour-spot" style={position.spot} aria-hidden="true" />}
      <section className="welcome-tour-card" ref={panelRef} style={position?.card}
        role="dialog" aria-modal="true" aria-label="Welcome tour" aria-describedby={descriptionId} onKeyDown={handleKey}>
        <p className="welcome-tour-step">Step {index + 1} of {steps.length}</p>
        <h2 className="display" ref={titleRef} tabIndex={-1}>{step.title}</h2>
        <div id={descriptionId} className="welcome-tour-description">
          <p>{step.text}</p>
          {step.cue && <p className="welcome-tour-cue">{step.cue}</p>}
        </div>
        <div className="welcome-tour-actions">
          <Btn variant="ghost" onClick={onDismiss}>Skip tour</Btn>
          <div>
            <Btn variant="outline" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</Btn>
            <Btn onClick={final ? onDismiss : () => setIndex(index + 1)}>{final ? 'Finish' : 'Next'}</Btn>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
