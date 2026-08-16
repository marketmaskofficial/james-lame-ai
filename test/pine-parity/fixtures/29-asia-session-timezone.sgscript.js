// @name Market Session Boxes
// @overlay true

function toMilliseconds(timestamp) {
    return timestamp < 100000000000 ? timestamp * 1000 : timestamp;
}

function nthSundayUtc(year, month, occurrence, hourUtc) {
    const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const firstSunday = 1 + ((7 - firstDay) % 7);
    const day = firstSunday + (occurrence - 1) * 7;
    return Date.UTC(year, month, day, hourUtc, 0, 0, 0);
}

function lastSundayUtc(year, month, hourUtc) {
    const lastDate = new Date(Date.UTC(year, month + 1, 0));
    const day = lastDate.getUTCDate() - lastDate.getUTCDay();
    return Date.UTC(year, month, day, hourUtc, 0, 0, 0);
}

function isNewYorkDst(timestampMs) {
    const year = new Date(timestampMs).getUTCFullYear();
    let dstStart;
    let dstEnd;

    if (year >= 2007) {
        dstStart = nthSundayUtc(year, 2, 2, 7);
        dstEnd = nthSundayUtc(year, 10, 1, 6);
    } else if (year >= 1987) {
        dstStart = nthSundayUtc(year, 3, 1, 7);
        dstEnd = lastSundayUtc(year, 9, 6);
    } else {
        dstStart = lastSundayUtc(year, 3, 7);
        dstEnd = lastSundayUtc(year, 9, 6);
    }

    return timestampMs >= dstStart && timestampMs < dstEnd;
}

function inAsiaSession(timestamp) {
    if (!Number.isFinite(timestamp)) {
        return false;
    }

    const timestampMs = toMilliseconds(timestamp);
    const offsetHours = isNewYorkDst(timestampMs) ? -4 : -5;
    const localDate = new Date(timestampMs + offsetHours * 60 * 60 * 1000);
    const localHour = localDate.getUTCHours();

    return localHour >= 20;
}

const completedSessions = [];

let previousInSession = false;
let sessHigh = NaN;
let sessLow = NaN;
let sessStartBar = -1;

for (let i = 0; i < barCount; i++) {
    const currentInSession = inAsiaSession(time[i]);
    const newSession = currentInSession && !previousInSession;
    const endSession = !currentInSession && previousInSession;

    if (newSession) {
        sessHigh = high[i];
        sessLow = low[i];
        sessStartBar = i;
    } else if (currentInSession) {
        if (Number.isFinite(high[i])) {
            sessHigh = Number.isFinite(sessHigh)
                ? Math.max(sessHigh, high[i])
                : high[i];
        }

        if (Number.isFinite(low[i])) {
            sessLow = Number.isFinite(sessLow)
                ? Math.min(sessLow, low[i])
                : low[i];
        }
    }

    if (
        endSession &&
        sessStartBar >= 0 &&
        Number.isFinite(sessHigh) &&
        Number.isFinite(sessLow)
    ) {
        completedSessions.push({
            from: sessStartBar,
            to: i,
            top: sessHigh,
            bottom: sessLow
        });

        sessHigh = NaN;
        sessLow = NaN;
        sessStartBar = -1;
    }

    previousInSession = currentInSession;
}

const firstVisibleSession = Math.max(0, completedSessions.length - 50);

for (let i = firstVisibleSession; i < completedSessions.length; i++) {
    const sessionBox = completedSessions[i];

    if (
        Number.isFinite(sessionBox.top) &&
        Number.isFinite(sessionBox.bottom) &&
        Number.isFinite(sessionBox.from) &&
        Number.isFinite(sessionBox.to)
    ) {
        box(
            sessionBox.top,
            sessionBox.bottom,
            sessionBox.from,
            sessionBox.to,
            {
                color: '#FF9800',
                opacity: 0.10,
                borderColor: '#FF9800',
                borderWidth: 1,
                borderStyle: 'solid',
                extend: 'none'
            }
        );

        label(
            sessionBox.from,
            sessionBox.top,
            'Asia Session',
            {
                color: '#FF9800',
                textColor: '#FFFFFF',
                borderColor: '#FF9800',
                size: 'normal',
                align: 'center',
                offset: 0,
                position: 'above'
            }
        );
    }
}
