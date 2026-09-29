// Bounded, diagnostic-only sampled history. firstSeenMs is an observation
// timestamp, not an exact insertion time. No consent controls are clicked.
export function createWithdrawalTimeline() {
  const frames = new Map();
  const records = new Map();
  let sampleCount = 0;
  let failedSamples = 0;
  let truncated = false;
  let firstSampleMs = null;
  let lastSampleMs = null;
  return {
    failed() { failedSamples += 1; },
    record(frame, snapshot) {
      if (!snapshot || snapshot.error) { failedSamples += 1; return; }
      if (!frames.has(frame)) frames.set(frame, frames.size);
      const frameIndex = frames.get(frame);
      if (frameIndex >= 10) { truncated = true; return; }
      sampleCount += 1;
      const absoluteMs = Number(snapshot.documentId) + snapshot.observedAtMs;
      if (Number.isFinite(absoluteMs)) {
        firstSampleMs = Math.min(firstSampleMs ?? absoluteMs, absoluteMs);
        lastSampleMs = Math.max(lastSampleMs ?? absoluteMs, absoluteMs);
      }
      truncated ||= snapshot.truncated;
      for (const record of records.values()) {
        if (record.frameIndex === frameIndex) record.presentInLastSample = false;
      }
      for (const candidate of snapshot.candidates) {
        const key = frameIndex + ':' + snapshot.documentId + ':' + candidate.key;
        let record = records.get(key);
        if (!record) {
          if (records.size >= 60) {
            truncated = true;
            const internal = [...records].find(([, value]) => value.candidate.insideBanner);
            if (candidate.insideBanner || !internal) continue;
            records.delete(internal[0]);
          }
          let frameUrl = '';
          try { const u = new URL(frame.url()); frameUrl = (u.origin + u.pathname).slice(0, 180); } catch {}
          record = {
            frameIndex, frameUrl, documentId: snapshot.documentId,
            firstSeenMs: snapshot.observedAtMs,
            firstVisibleMs: null, observations: 0, transitions: [],
            candidate
          };
          records.set(key, record);
        }
        record.presentInLastSample = true;
        record.lastSeenMs = snapshot.observedAtMs;
        record.observations += 1;
        if (candidate.visible && record.firstVisibleMs === null) record.firstVisibleMs = snapshot.observedAtMs;
        const state = { visible: candidate.visible, hiddenReasons: candidate.hiddenReasons, insideBanner: candidate.insideBanner };
        const previous = record.transitions.at(-1);
        if (!previous || JSON.stringify(previous.state) !== JSON.stringify(state)) {
          if (record.transitions.length < 6) record.transitions.push({ atMs: snapshot.observedAtMs, state });
          else truncated = true;
        }
        record.candidate = candidate;
      }
    },
    finish() {
      const all = [...records.values()].sort((a, b) =>
        Number(a.candidate.insideBanner) - Number(b.candidate.insideBanner));
      return {
        schemaVersion: 1, phase: 'pre-interaction', sampled: true,
        timeBasis: 'milliseconds since each document navigation; first observed, not exact insertion',
        scope: 'main document and accessible frames; open shadow roots',
        sampleCount, failedSamples, frameCount: frames.size,
        observationSpanMs: firstSampleMs === null ? 0 : lastSampleMs - firstSampleMs,
        candidateCount: all.length, truncated: truncated || all.length > 30,
        candidates: all.slice(0, 30)
      };
    }
  };
}
