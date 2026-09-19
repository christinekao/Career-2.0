import React, { useEffect, useMemo, useState } from 'react';

const EXECUTION_STATES = ['IDLE', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED', 'STALE_RESULT_REJECTED'];
const CONTENT_STATES = ['SELECTION_REQUIRED', 'LOADING', 'EMPTY', 'AVAILABLE_CURRENT', 'STALE', 'FAILED_UNAVAILABLE'];

function projectSurface({ selected, loading, hasResult, fresh, executionState }) {
  if (!EXECUTION_STATES.includes(executionState)) throw new Error('Unsupported execution state.');
  if (!selected) return { content: 'SELECTION_REQUIRED', execution: 'IDLE' };
  if (loading) return { content: 'LOADING', execution: 'IDLE' };
  const base = hasResult ? (fresh ? 'AVAILABLE_CURRENT' : 'STALE') : 'EMPTY';
  if (executionState === 'RUNNING') return { content: hasResult ? base : 'LOADING', execution: executionState };
  if (executionState === 'COMPLETED') return { content: hasResult && fresh ? 'AVAILABLE_CURRENT' : 'STALE', execution: hasResult && fresh ? executionState : 'IDLE' };
  if (executionState === 'FAILED') return { content: hasResult ? base : 'FAILED_UNAVAILABLE', execution: executionState };
  if (executionState === 'CANCELLED') return { content: hasResult ? base : 'EMPTY', execution: executionState };
  if (executionState === 'STALE_RESULT_REJECTED') return { content: hasResult ? base : 'EMPTY', execution: executionState };
  return { content: base, execution: 'IDLE' };
}

function errorMessage(error) {
  return error?.message || 'The intelligence slice is unavailable.';
}

function SourceLink({ value }) {
  if (!value) return <span className="trace">source unavailable</span>;
  const href = typeof value === 'string' ? value : value.reference || value.uri || value.locator;
  if (!href) return <span className="trace">source unavailable</span>;
  return <a className="trace source-link" href={href} onClick={(event) => event.preventDefault()}>{href}</a>;
}

export default function App() {
  const [status, setStatus] = useState({ phase: 'starting' });
  const [opportunities, setOpportunities] = useState([]);
  const [evidenceRecords, setEvidenceRecords] = useState([]);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState('');
  const [selectedJdRevisionId, setSelectedJdRevisionId] = useState('');
  const [selectedEvidenceRevisionIds, setSelectedEvidenceRevisionIds] = useState([]);
  const [context, setContext] = useState(null);
  const [execution, setExecution] = useState(null);
  const [positioning, setPositioning] = useState(null);
  const [surface, setSurface] = useState({ content: 'SELECTION_REQUIRED', execution: 'IDLE' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const api = window.careerFoundation;
  const selectedOpportunity = useMemo(
    () => opportunities.find((item) => item.opportunityId === selectedOpportunityId) || null,
    [opportunities, selectedOpportunityId],
  );
  const confirmedEvidence = useMemo(
    () => evidenceRecords.flatMap((record) => record.revisions || [])
      .filter((revision) => revision.confirmationState === 'CONFIRMED'),
    [evidenceRecords],
  );
  const payload = execution?.result_payload || null;
  const hasResult = Boolean(payload || positioning);

  useEffect(() => {
    let active = true;
    Promise.all([api?.getStatus?.(), api?.opportunity?.list?.(), api?.evidence?.list?.()])
      .then(([nextStatus, nextOpportunities, nextEvidence]) => {
        if (!active) return;
        setStatus(nextStatus || { phase: 'unavailable' });
        setOpportunities(nextOpportunities || []);
        setEvidenceRecords(nextEvidence || []);
      })
      .catch((nextError) => active && setError(errorMessage(nextError)));
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    let active = true;
    if (!selectedOpportunity) {
      setContext(null);
      setExecution(null);
      setPositioning(null);
      setSelectedEvidenceRevisionIds([]);
      setSelectedJdRevisionId('');
      setSurface(projectSurface({ selected: false, loading: false, hasResult: false, fresh: true, executionState: 'IDLE' }));
      return () => { active = false; };
    }
    setContext(null);
    setExecution(null);
    setPositioning(null);
    setSelectedEvidenceRevisionIds([]);
    const revision = selectedOpportunity.jdRevisions?.find((item) => item.jdRevisionId === selectedJdRevisionId)
      || selectedOpportunity.jdRevisions?.find((item) => item.availabilityStatus === 'AVAILABLE');
    if (!revision) {
      setSelectedJdRevisionId('');
      setContext(null);
      setSurface({ content: 'FAILED_UNAVAILABLE', execution: 'FAILED' });
      return () => { active = false; };
    }
    setSelectedJdRevisionId(revision.jdRevisionId);
    setBusy(true);
    api.intelligence.loadContext({ opportunityId: selectedOpportunity.opportunityId, jdRevisionId: revision.jdRevisionId })
      .then((nextContext) => {
        if (!active) return;
        setContext(nextContext);
        const nextExecution = nextContext.currentExecution || null;
        const nextPositioning = nextContext.currentPositioning || null;
        setExecution(nextExecution);
        setPositioning(nextPositioning);
        setError(null);
        setSurface(projectSurface({
          selected: true,
          loading: false,
          hasResult: Boolean(nextExecution?.result_payload || nextPositioning),
          fresh: true,
          executionState: nextExecution?.execution_state || 'IDLE',
        }));
      })
      .catch((nextError) => {
        if (!active) return;
        setContext(null);
        setError(errorMessage(nextError));
        setSurface({ content: 'FAILED_UNAVAILABLE', execution: 'FAILED' });
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [selectedOpportunityId, selectedJdRevisionId, selectedOpportunity, api]);

  function selectEvidence(event) {
    const id = event.target.value;
    setSelectedEvidenceRevisionIds(id ? [id] : []);
    setExecution(null);
    setPositioning(null);
    setSurface(projectSurface({ selected: Boolean(context), loading: false, hasResult: false, fresh: true, executionState: 'IDLE' }));
  }

  async function runAnalysis() {
    if (!context || !selectedEvidenceRevisionIds.length) {
      setError('Select a confirmed Evidence revision before running intelligence.');
      setSurface({ content: 'FAILED_UNAVAILABLE', execution: 'FAILED' });
      return;
    }
    setBusy(true);
    setError(null);
    setExecution({ execution_state: 'RUNNING' });
    setSurface(projectSurface({ selected: true, loading: false, hasResult, fresh: true, executionState: 'RUNNING' }));
    try {
      const nextExecution = await api.intelligence.startExecution({
        opportunityId: selectedOpportunityId,
        jdRevisionId: selectedJdRevisionId,
        evidenceRevisionIds: selectedEvidenceRevisionIds,
        inputGeneration: `ui:${selectedJdRevisionId}:${selectedEvidenceRevisionIds.join(',')}`,
        operationType: 'ANALYZE_REQUIREMENTS',
        executionId: `ui-execution:${Date.now()}`,
        idempotencyKey: `ui-idempotency:${Date.now()}`,
        disclosureClassification: 'LOCAL_SYNTHETIC',
      });
      setExecution(nextExecution);
      setPositioning(nextExecution.result_payload?.positioning || null);
      const nextExecutionState = nextExecution.execution_state === 'STALE_RESULT_REJECTED' ? 'STALE_RESULT_REJECTED' : nextExecution.execution_state;
      setSurface(projectSurface({ selected: true, loading: false, hasResult: Boolean(nextExecution.result_payload) || hasResult, fresh: nextExecutionState === 'COMPLETED' || hasResult, executionState: nextExecutionState }));
    } catch (nextError) {
      setError(errorMessage(nextError));
      setExecution({ execution_state: 'FAILED' });
      setSurface(projectSurface({ selected: true, loading: false, hasResult, fresh: true, executionState: 'FAILED' }));
    } finally {
      setBusy(false);
    }
  }

  async function cancelAnalysis() {
    if (!execution?.execution_id) return;
    setBusy(true);
    try {
      const cancelled = await api.intelligence.cancelExecution(execution.execution_id);
      setExecution(cancelled);
      setSurface(projectSurface({ selected: true, loading: false, hasResult, fresh: true, executionState: 'CANCELLED' }));
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPositioning() {
    if (!positioning?.positioning_version_id) return;
    setBusy(true);
    try {
      const confirmed = await api.intelligence.confirmPositioning(positioning.positioning_version_id, new Date().toISOString());
      setPositioning(confirmed);
      setSurface(projectSurface({ selected: true, loading: false, hasResult: true, fresh: true, executionState: 'COMPLETED' }));
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  const contextState = CONTENT_STATES.includes(surface.content) ? surface.content : 'FAILED_UNAVAILABLE';

  return (
    <main className="intelligence-shell">
      <header className="hero">
        <p className="eyebrow">Career 2.0 · M2 intelligence</p>
        <h1>Opportunity intelligence</h1>
        <p className="status-value" data-testid="application-status">{status.phase || 'starting'}</p>
      </header>

      <section className="panel" aria-labelledby="selection-heading">
        <div className="panel-heading"><div><p className="eyebrow">Context</p><h2 id="selection-heading">Select an Opportunity</h2></div><span className="state-chip">{contextState}</span></div>
        <label>Opportunity
          <select value={selectedOpportunityId} onChange={(event) => setSelectedOpportunityId(event.target.value)} data-testid="opportunity-select">
            <option value="">Select an existing Opportunity</option>
            {opportunities.map((item) => <option value={item.opportunityId} key={item.opportunityId}>{item.companyName} · {item.roleTitle}</option>)}
          </select>
        </label>
        <label>JD revision
          <select value={selectedJdRevisionId} onChange={(event) => setSelectedJdRevisionId(event.target.value)} disabled={!selectedOpportunity} data-testid="jd-select">
            <option value="">Select an available JD revision</option>
            {selectedOpportunity?.jdRevisions?.filter((item) => item.availabilityStatus === 'AVAILABLE').map((item) => <option value={item.jdRevisionId} key={item.jdRevisionId}>Revision {item.revisionNumber} · {item.sourceRef || 'source unavailable'}</option>)}
          </select>
        </label>
        {context ? <div className="context-summary"><strong>{context.opportunity.companyName} · {context.opportunity.roleTitle}</strong><span>Opportunity <code>{context.opportunity.opportunityId}</code></span><span>JD <code>{context.jdRevision.jdRevisionId}</code> · Revision {context.jdRevision.revisionNumber}</span><SourceLink value={context.jdRevision.sourceRef} /></div> : null}
      </section>

      <section className="panel" aria-labelledby="analysis-heading">
        <div className="panel-heading"><div><p className="eyebrow">Evidence gate</p><h2 id="analysis-heading">Match &amp; Gaps</h2></div><span className="state-chip">{surface.execution}</span></div>
        <label>Confirmed Evidence revision
          <select value={selectedEvidenceRevisionIds[0] || ''} onChange={selectEvidence} disabled={!context} data-testid="evidence-select">
            <option value="">Select eligible confirmed Evidence</option>
            {confirmedEvidence.map((item) => <option value={item.evidenceRevisionId} key={item.evidenceRevisionId}>Revision {item.revisionNumber} · {item.provenance?.reference || 'confirmed source'}</option>)}
          </select>
        </label>
        {!confirmedEvidence.length ? <p className="notice">No confirmed Evidence is available. Intelligence remains unavailable until one is confirmed.</p> : null}
        <div className="actions"><button type="button" onClick={runAnalysis} disabled={busy || !context || !selectedEvidenceRevisionIds.length}>Run intelligence</button><button type="button" className="secondary" onClick={cancelAnalysis} disabled={busy || execution?.execution_state !== 'RUNNING'}>Cancel</button></div>
        {surface.content === 'FAILED_UNAVAILABLE' ? <p className="notice error">Unavailable or failed. Review the selected context and retry.</p> : null}
        {error ? <p className="notice error" role="alert">{error}</p> : null}
        {payload?.requirements ? <div className="result-block"><h3>Requirements</h3><ul>{payload.requirements.map((item) => <li key={item.requirement_id}><strong>{item.priority}</strong> {item.normalized_content}<span className="trace">{item.requirement_id}</span><SourceLink value={item.source_ref} /></li>)}</ul></div> : null}
        {payload?.matches ? <div className="result-block"><h3>Matches and gaps</h3><ul>{payload.matches.map((item) => <li key={item.match_id}><strong>{item.classification}</strong> {item.explanation}<span className="trace">{item.evidence_revision_ids.join(', ') || 'No confirmed Evidence support'}</span></li>)}</ul></div> : null}
      </section>

      <section className="panel" aria-labelledby="positioning-heading">
        <div className="panel-heading"><div><p className="eyebrow">Strategy candidate</p><h2 id="positioning-heading">Positioning</h2></div><span className="state-chip">{positioning?.state || 'EMPTY'}</span></div>
        {positioning?.claims?.length ? <ul>{positioning.claims.map((claim) => <li key={claim.positioning_claim_id}><strong>{claim.claim_kind}</strong> {claim.claim_text}<span className="trace">{claim.match_id || claim.gap_id}</span></li>)}</ul> : <p className="notice">A validated candidate will appear here. Positioning is never confirmed automatically.</p>}
        {positioning?.state === 'CANDIDATE' ? <button type="button" onClick={confirmPositioning} disabled={busy}>Confirm positioning</button> : null}
        {positioning?.state === 'CONFIRMED' ? <p className="confirmed">Confirmed current positioning · {positioning.positioning_version_id}</p> : null}
      </section>
      <p className="scope-note">Local, purpose-specific surface. Career Evidence remains the canonical source of truth.</p>
    </main>
  );
}
