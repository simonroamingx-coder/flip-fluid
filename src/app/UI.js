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

function formatCount(value)
{
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// The settings panel. Dragging the slider only moves a pending value; the scene
// is rebuilt when Apply is pressed, never while dragging. The count that comes
// back is reported next to the one that was asked for, because the lattice is
// discrete and the two are rarely the same number.
export function attachSettings(doc, { particleCount, onApply })
{
    const slider = doc.getElementById('particleSlider');
    const value = doc.getElementById('particleValue');
    const actual = doc.getElementById('particleActual');
    const apply = doc.getElementById('applyParticles');

    if (!slider || !value || !actual || !apply)
        return null;

    slider.value = String(particleCount);
    value.textContent = formatCount(slider.value);

    slider.addEventListener('input', () => {
        value.textContent = formatCount(slider.value);
    });

    apply.addEventListener('click', () => {
        const result = onApply(Number(slider.value));
        if (!result)
            return;

        actual.textContent = result.actual === result.requested
            ? `${formatCount(result.actual)} particles`
            : `${formatCount(result.actual)} particles (asked for ${formatCount(result.requested)}, grid ${result.resolution})`;
    });

    return { report: text => { actual.textContent = text; } };
}

// The debug panel. The rows are described once here and the values are written
// into them when the loop hands over a set of statistics; nothing in this file
// measures or computes anything.
const DEBUG_ROWS = [
    { key: 'fps', label: 'FPS', format: value => value.toFixed(1) },
    { key: 'frameTime', label: 'Frame Time', format: value => value.toFixed(1) + ' ms' },
    { key: 'simulationTime', label: 'Simulation', format: value => value.toFixed(1) + ' ms' },
    { key: 'particleTime', label: 'Particle Update', format: value => value.toFixed(1) + ' ms', sub: true },
    { key: 'particleToGridTime', label: 'Particle to Grid', format: value => value.toFixed(1) + ' ms', sub: true },
    { key: 'pressureTime', label: 'Pressure Solve', format: value => value.toFixed(1) + ' ms', sub: true },
    { key: 'gridToParticleTime', label: 'Grid to Particle', format: value => value.toFixed(1) + ' ms', sub: true },
    { key: 'collisionTime', label: 'Collision', format: value => value.toFixed(1) + ' ms', sub: true },
    { key: 'otherTime', label: 'Other', format: value => value.toFixed(1) + ' ms', sub: true },
    { key: 'renderTime', label: 'Render', format: value => value.toFixed(1) + ' ms' },
    { key: 'particleCount', label: 'Particles', format: formatCount },
    { key: 'activeParticles', label: 'Active', format: formatCount },
    { key: 'gridCells', label: 'Grid Cells', format: formatCount },
    { key: 'fluidCells', label: 'Fluid Cells', format: formatCount },
    { section: 'Solver' },
    { key: 'dt', label: 'Time Step', format: value => (value * 1000).toFixed(2) + ' ms' },
    { key: 'gridResolution', label: 'Grid Resolution', format: value => String(value) },
    { key: 'pressureIters', label: 'Pressure Iters', format: value => String(value) },
    { key: 'flipRatio', label: 'FLIP Ratio', format: value => value.toFixed(2) },
    { key: 'memoryBytes', label: 'Memory', format: value => (value / 1048576).toFixed(1) + ' MB' }
];

const DEBUG_VIEWS = [
    { id: 'showPressure', key: 'pressure' },
    { id: 'showCellTypes', key: 'cellTypes' },
    { id: 'showVelocity', key: 'velocity' }
];

export function attachDebugPanel(doc, { enabled, views, onToggle, onViews })
{
    const checkbox = doc.getElementById('debugEnabled');
    const body = doc.getElementById('debugStats');
    const viewBox = doc.getElementById('debugViews');

    if (!checkbox || !body)
        return null;

    const cells = new Map();
    const viewBoxes = new Map();

    for (const row of DEBUG_ROWS) {
        const line = doc.createElement('div');

        // A section marker is a label with no value, so the list can grow a
        // second group without another block of markup.
        if (row.section) {
            line.className = 'stat section';
            line.textContent = row.section;
            body.append(line);
            continue;
        }

        line.className = row.sub ? 'stat sub' : 'stat';

        const label = doc.createElement('span');
        label.textContent = row.label;

        const value = doc.createElement('span');
        value.className = 'value';
        value.textContent = row.format(0);

        line.append(label, value);
        body.append(line);
        cells.set(row.key, { format: row.format, element: value });
    }

    for (const view of DEBUG_VIEWS) {
        const box = doc.getElementById(view.id);
        if (!box)
            continue;

        box.checked = Boolean(views && views[view.key]);
        box.addEventListener('change', () => {
            const next = {};
            for (const [key, element] of viewBoxes)
                next[key] = element.checked;
            next[view.key] = box.checked;
            onViews(next);
        });
        viewBoxes.set(view.key, box);
    }

    checkbox.checked = enabled;
    body.hidden = !enabled;
    if (viewBox)
        viewBox.hidden = !enabled;

    const panel = {
        update(stats)
        {
            for (const [key, cell] of cells)
                cell.element.textContent = cell.format(stats[key]);
        },

        setEnabled(value)
        {
            checkbox.checked = value;
            body.hidden = !value;
            if (viewBox)
                viewBox.hidden = !value;
            if (!value) {
                for (const cell of cells.values())
                    cell.element.textContent = cell.format(0);
            }
        },

        setViews(next)
        {
            for (const [key, element] of viewBoxes)
                element.checked = Boolean(next[key]);
        }
    };

    checkbox.addEventListener('change', () => onToggle(checkbox.checked));

    return panel;
}
