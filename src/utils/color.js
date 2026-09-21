// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

// A colour input gives "#rrggbb"; the renderer wants three floats. The conversion
// belongs at that boundary rather than in either side, so neither has to know the
// other's format.
export function hexToRgb(hex)
{
    const value = String(hex).replace('#', '');
    const full = value.length === 3
        ? value.split('').map(character => character + character).join('')
        : value;

    const number = Number.parseInt(full, 16);
    if (!Number.isFinite(number) || full.length !== 6)
        return [1, 0, 0];

    return [
        ((number >> 16) & 0xff) / 255,
        ((number >> 8) & 0xff) / 255,
        (number & 0xff) / 255
    ];
}
