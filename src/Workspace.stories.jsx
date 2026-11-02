import Practice, { ReferencePanel } from './Practice.jsx';
import { Progress } from './App.jsx';
import WebcamTest from './WebcamTest.jsx';
import { candidates } from './content.js';

export default { title: 'Personal workspace / Honest states' };
export const AutomaticCamera = { render: () => <Practice selected={null} onSave={() => {}} mirror={true} setMirror={() => {}} overlay={true} setOverlay={() => {}} /> };
export const WebcamTestIntro = { render: () => <WebcamTest mirror={true} overlay={true} /> };
export const ReferencePending = { render: () => <div style={{ maxWidth: 360 }}><ReferencePanel selected={candidates.find(c => !c.reference)} /></div> };
export const SourceVideo = { render: () => <div style={{ maxWidth: 420 }}><ReferencePanel selected={candidates.find(c => c.label === 'Hello')} /></div> };
export const EmptySessions = { render: () => <Progress sessions={[]} onClear={() => {}} /> };
export const SyntheticSessionLayout = { render: () => <><p className="demo-notice">Synthetic UI fixture only. Not personal history or measured results.</p><Progress sessions={[{ schemaVersion: 1, id: 'story-fixture', kind: 'personal-tracking-exercise', mode: 'tracking-only', startedAt: '2026-01-01T12:00:00Z', durationMs: 17500, sampledFrames: 45, framesWithHands: 0, trackingLatencyMeanMs: null }]} onClear={() => {}} /></> };
