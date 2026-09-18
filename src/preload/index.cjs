const { contextBridge, ipcRenderer } = require('electron');

const PUBLIC_ERROR_ENVELOPE_KEY = '__career2PublicError';
const PUBLIC_ERROR_FALLBACK = Object.freeze({
  code: 'DOMAIN_OPERATION_FAILED',
  message: 'The domain operation failed.',
});

function isPublicError(value) {
  return value
    && typeof value === 'object'
    && Object.keys(value).length === 2
    && typeof value.code === 'string'
    && typeof value.message === 'string';
}

async function invokeDomain(channel, ...args) {
  let result;
  try {
    result = await ipcRenderer.invoke(channel, ...args);
  } catch {
    throw PUBLIC_ERROR_FALLBACK;
  }
  if (result && Object.prototype.hasOwnProperty.call(result, PUBLIC_ERROR_ENVELOPE_KEY)) {
    const publicError = result[PUBLIC_ERROR_ENVELOPE_KEY];
    throw isPublicError(publicError) ? { code: publicError.code, message: publicError.message } : PUBLIC_ERROR_FALLBACK;
  }
  return result;
}

contextBridge.exposeInMainWorld('careerFoundation', {
  getStatus: () => ipcRenderer.invoke('foundation:get-status'),
  opportunity: {
    create: (input) => invokeDomain('opportunity:create', input),
    get: (opportunityId) => invokeDomain('opportunity:get', opportunityId),
    addJdRevision: (opportunityId, input) => invokeDomain('opportunity:add-jd-revision', opportunityId, input),
    getJdRevision: (opportunityId, jdRevisionId) => invokeDomain('opportunity:get-jd-revision', opportunityId, jdRevisionId),
  },
  evidence: {
    create: (input) => invokeDomain('evidence:create', input),
    get: (evidenceId) => invokeDomain('evidence:get', evidenceId),
    createRevision: (evidenceId, input) => invokeDomain('evidence:create-revision', evidenceId, input),
    confirmRevision: (evidenceId, evidenceRevisionId, confirmedAt) => (
      invokeDomain('evidence:confirm-revision', evidenceId, evidenceRevisionId, confirmedAt)
    ),
  },
});
