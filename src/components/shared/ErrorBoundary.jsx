import { Component } from 'react';
import { C } from '../../lib/theme';

export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error('UI error:', error, info?.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: this.props.inline ? 240 : '100vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', color: C.textPrimary, background: this.props.inline ? 'transparent' : C.pageBg }}>
        <div style={{ maxWidth: 420 }}>
          <h1 className="display" style={{ fontSize: 30, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: C.textSecondary, lineHeight: 1.5, marginBottom: 18 }}>This page hit an unexpected problem. Your data is safe. Reloading usually fixes it.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ background: C.gold, color: '#0C1B3A', border: 'none', borderRadius: 10, padding: '11px 22px', fontWeight: 700, fontSize: 14 }}>Reload page</button>
        </div>
      </div>
    );
  }
}
