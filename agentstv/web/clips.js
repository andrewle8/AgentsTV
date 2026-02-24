/* AgentsTV — clip recording via canvas capture + MediaRecorder */

let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = 0;
let durationInterval = null;

/**
 * Initialize clip recording. Call once on app boot.
 * Attaches click handler to the record button.
 */
export function initClips() {
    const btn = document.getElementById('record-btn');
    if (!btn) return;
    btn.addEventListener('click', toggleRecording);
}

function toggleRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    const canvas = document.getElementById('webcam-canvas');
    if (!canvas) return;

    const stream = canvas.captureStream(15); // 15 fps
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

    try {
        mediaRecorder = new MediaRecorder(stream, { mimeType });
    } catch (e) {
        console.error('MediaRecorder failed:', e);
        return;
    }

    recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
        }
    };

    mediaRecorder.onstop = () => {
        downloadClip();
        cleanupUI();
    };

    mediaRecorder.onerror = () => {
        cleanupUI();
    };

    mediaRecorder.start(500); // collect data every 500ms
    recordingStartTime = Date.now();

    // Update UI
    const btn = document.getElementById('record-btn');
    if (btn) {
        btn.classList.add('recording');
        btn.title = 'Stop recording';
    }

    // Start duration counter
    updateDuration();
    durationInterval = setInterval(updateDuration, 1000);
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}

function downloadClip() {
    if (recordedChunks.length === 0) return;

    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `agentstv-clip-${ts}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke after a short delay to ensure download starts
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    recordedChunks = [];
}

function cleanupUI() {
    const btn = document.getElementById('record-btn');
    if (btn) {
        btn.classList.remove('recording');
        btn.title = 'Record clip';
    }
    const dur = document.getElementById('record-duration');
    if (dur) dur.textContent = '';
    if (durationInterval) {
        clearInterval(durationInterval);
        durationInterval = null;
    }
    mediaRecorder = null;
}

function updateDuration() {
    const dur = document.getElementById('record-duration');
    if (!dur) return;
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    dur.textContent = `${m}:${String(s).padStart(2, '0')}`;
}
