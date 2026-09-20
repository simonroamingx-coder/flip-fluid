// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

// The original wired these controls through inline onclick/onchange attributes
// on the elements themselves. The behaviour is identical - each checkbox flips
// its scene flag on click, and the slider sets flipRatio on change - it is just
// attached here instead of in the markup.

export const TOGGLES = [
    { id: 'showParticles', flag: 'showParticles' },
    { id: 'showGrid', flag: 'showGrid' },
    { id: 'compensateDrift', flag: 'compensateDrift' },
    { id: 'separateParticles', flag: 'separateParticles' }
];

export function attachControls(doc, scene)
{
    for (const { id, flag } of TOGGLES) {
        const element = doc.getElementById(id);
        if (!element)
            continue;
        element.addEventListener('click', () => {
            scene[flag] = !scene[flag];
        });
    }

    const slider = doc.getElementById('flipSlider');
    if (slider) {
        slider.addEventListener('change', event => {
            scene.flipRatio = 0.1 * event.target.value;
        });
    }
}
