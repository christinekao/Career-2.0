import React, { useEffect, useState } from 'react';

export default function App() {
  const [status, setStatus] = useState({ phase: 'starting' });

  useEffect(() => {
    window.careerFoundation
      .getStatus()
      .then(setStatus)
      .catch((error) => setStatus({ phase: 'error', message: error.message }));
  }, []);

  return (
    <main className="foundation-shell">
      <p className="eyebrow">Career 2.0</p>
      <h1>Local foundation</h1>
      <p className="status-label">Application status</p>
      <p className="status-value">{status.phase}</p>
      {status.message ? <p className="status-message">{status.message}</p> : null}
      <p className="scope-note">Foundation only. No product records are loaded.</p>
    </main>
  );
}
