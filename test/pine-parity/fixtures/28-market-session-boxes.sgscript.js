// @name Market Session Boxes
// @overlay true

const inSession = session('09:30', '16:00');

let sessHigh = NaN;
let sessLow = NaN;
let sessStartBar = NaN;
let drawingCount = 0;

for (let i = 1; i < barCount; i++) {
    const newSession = inSession[i] && !inSession[i - 1];
    const endSession = !inSession[i] && inSession[i - 1];

    if (newSession) {
        sessHigh = high[i];
        sessLow = low[i];
        sessStartBar = i;
    } else if (inSession[i]) {
        if (Number.isFinite(sessHigh) && Number.isFinite(high[i])) {
            sessHigh = Math.max(sessHigh, high[i]);
        }
        if (Number.isFinite(sessLow) && Number.isFinite(low[i])) {
            sessLow = Math.min(sessLow, low[i]);
        }
    }

    if (
        endSession &&
        drawingCount <= 9998 &&
        Number.isFinite(sessStartBar) &&
        Number.isFinite(sessHigh) &&
        Number.isFinite(sessLow)
    ) {
        box(sessHigh, sessLow, sessStartBar, i, {
            color: '#0000FF',
            opacity: 0.1,
            borderColor: '#0000FF',
            borderWidth: 1,
            borderStyle: 'solid',
            extend: 'none'
        });

        label(sessStartBar, sessHigh, 'Session', {
            color: '#0000FF',
            textColor: '#FFFFFF',
            borderColor: '#0000FF',
            size: 'normal',
            align: 'center',
            position: 'above'
        });

        drawingCount += 2;
    }
}