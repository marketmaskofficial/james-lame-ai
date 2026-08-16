// @name Fair Value Gap Boxes
// @overlay true

const bullishFVG = gt(low, offset(high, 2));
const bearishFVG = lt(high, offset(low, 2));

const gaps = [];

for (let i = 2; i < barCount; i++) {
    if (bullishFVG[i] && Number.isFinite(high[i - 2]) && Number.isFinite(low[i])) {
        gaps.push({
            from: i - 2,
            to: i,
            top: high[i - 2],
            bottom: low[i],
            side: 'bull'
        });
    }

    if (bearishFVG[i] && Number.isFinite(low[i - 2]) && Number.isFinite(high[i])) {
        gaps.push({
            from: i - 2,
            to: i,
            top: low[i - 2],
            bottom: high[i],
            side: 'bear'
        });
    }
}

const firstGap = Math.max(0, gaps.length - 500);

for (let i = firstGap; i < gaps.length; i++) {
    const gap = gaps[i];
    const isBull = gap.side === 'bull';
    const color = isBull ? '#008000' : '#FF0000';

    box(gap.top, gap.bottom, gap.from, gap.to, {
        color: color,
        opacity: 15,
        borderColor: color,
        borderWidth: 1,
        borderStyle: 'solid',
        extend: 'right',
        state: 'active'
    });
}