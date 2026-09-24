import { downloadJson, type FlowSessionRecorder } from './optical-flow/session-recorder';

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Start/stop button for flow recording; stopping downloads the session log. */
export function mountRecordingButton(container: HTMLElement, recorder: FlowSessionRecorder): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'recording-button';
  container.append(button);

  let startedAt = 0;
  let labelTimer = 0;

  const render = () => {
    button.classList.toggle('recording', recorder.recording);
    button.textContent = recorder.recording
      ? `■ Stop flow recording (${formatDuration(performance.now() - startedAt)}, ${recorder.frameCount} frames)`
      : '● Record optical flow';
  };

  button.addEventListener('click', async () => {
    if (!recorder.recording) {
      recorder.start();
      startedAt = performance.now();
      labelTimer = window.setInterval(render, 250);
      render();
      return;
    }

    window.clearInterval(labelTimer);
    button.disabled = true;
    button.textContent = 'Saving…';

    const log = await recorder.stop();
    downloadJson(log, `optical-flow-${log.startedAt.replaceAll(':', '-')}.json`);

    button.disabled = false;
    render();
  });

  render();
}
