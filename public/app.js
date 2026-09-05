const $ = (id) => document.getElementById(id);
const form = $('scan-form');
const button = $('scan-button');
const progress = $('progress');
const errorBox = $('error');
const results = $('results');

const progressSteps = [
  ['Opening a clean browser session…', 'Loading the submitted public page without consent interaction.'],
  ['Recording initial browser signals…', 'Collecting cookies, browser storage, scripts and network requests.'],
  ['Inspecting consent and privacy controls…', 'Looking for visible consent actions, policy links and CMP markers.'],
  ['Classifying technical signals…', 'Checking common trackers, Consent Mode-related signals and conservative pre-interaction evidence.']
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
}

function renderCards(id, items, group) {
  const container = $(id);
  if (!items.length) {
    container.innerHTML = '<article class="card"><p class="why">No findings in this group for this scan.</p></article>';
    return;
  }
  container.innerHTML = items.map((item) => `
    <article class="card">
      <div class="card-head"><h3>${escapeHtml(item.title)}</h3><span class="confidence">${group === 'manual' ? 'Manual verification' : `${escapeHtml(item.confidence)} confidence`}</span></div>
      <span class="label">What was detected</span>
      <p class="detected">${escapeHtml(item.detected)}</p>
      <span class="label">Why it matters technically</span>
      <p class="why">${escapeHtml(item.why)}</p>
    </article>`).join('');
}

function renderReport(report) {
  $('score').textContent = report.score ?? '—';
  $('score-label').textContent = report.scoreLabel;
  $('score-explanation').textContent = report.scoreExplanation;
  $('score-coverage').textContent = `Coverage: ${report.scoreCoverage.assessedChecks}/${report.scoreCoverage.totalCoreChecks} core checks assessable (${report.scoreCoverage.percent}%). Unknown checks are not treated as passes.`;
  $('scan-location').textContent = `Scan location: ${report.scanLocation}. Regional behavior may differ elsewhere.`;
  $('passed-count').textContent = report.summary.passed;
  $('concern-count').textContent = report.summary.concerns;
  $('observation-count').textContent = report.summary.observations || 0;
  $('manual-count').textContent = report.summary.manual;
  renderCards('concerns-list', report.findings.concerns, 'concern');
  renderCards('passed-list', report.findings.passed, 'passed');
  renderCards('observations-list', report.findings.observations || [], 'observation');
  renderCards('manual-list', report.findings.manual, 'manual');

  const e = report.technicalEvidence;
  const evidence = [
    [e.requestCount, 'Network requests observed'],
    [e.cookieCount, 'Cookies on initial load'],
    [e.localStorageCount + e.sessionStorageCount, 'Browser storage keys'],
    [e.thirdPartyDomainCount, 'Third-party domains'],
    [e.cmpDetected.length || 0, 'CMP technologies detected'],
    [e.trackerTechnologies.length || 0, 'Tracker technologies detected'],
    [e.redirectCount, 'Redirects followed']
  ];
  $('evidence').innerHTML = evidence.map(([value,label]) => `<div class="evidence-item"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');

  const details = [];
  if (e.cmpDetected?.length) details.push(['CMP evidence', e.cmpEvidence.map((cmp) => `${cmp.name}: ${cmp.evidence.join(' | ')}`).join('\n')]);
  if (e.trackerTechnologies?.length) details.push(['Tracker technologies', e.trackerTechnologies.join(', ')]);
  if (e.thirdPartyDomains?.length) details.push(['Third-party domains', e.thirdPartyDomains.join(', ')]);
  if (e.consentModeSignals?.length) details.push(['Consent Mode signals', e.consentModeSignals.join(' | ')]);
  if (e.googleTagConsentKeys?.length) details.push(['Google consent runtime keys', e.googleTagConsentKeys.join(', ')]);
  $('evidence-details').innerHTML = details.length
    ? details.map(([label, value]) => `<div class="evidence-detail"><strong>${escapeHtml(label)}</strong><pre>${escapeHtml(value)}</pre></div>`).join('')
    : '<p class="coverage-note">No additional classified evidence to display for this scan.</p>';

  $('limitations-list').innerHTML = report.limitations.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  $('disclaimer').textContent = report.disclaimer;
  results.classList.remove('hidden');
  results.scrollIntoView({ behavior:'smooth', block:'start' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  results.classList.add('hidden');
  errorBox.classList.add('hidden');
  progress.classList.remove('hidden');
  button.disabled = true;

  let step = 0;
  $('progress-title').textContent = progressSteps[0][0];
  $('progress-detail').textContent = progressSteps[0][1];
  const interval = setInterval(() => {
    step = Math.min(step + 1, progressSteps.length - 1);
    $('progress-title').textContent = progressSteps[step][0];
    $('progress-detail').textContent = progressSteps[step][1];
  }, 2600);

  try {
    const response = await fetch('/api/scan', {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ url:$('url').value })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'The scan could not be completed.');
    renderReport(body);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove('hidden');
  } finally {
    clearInterval(interval);
    progress.classList.add('hidden');
    button.disabled = false;
  }
});
