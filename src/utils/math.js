// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

export function clamp(x, min, max)
{
    if (x < min)
        return min;
    else if (x > max)
        return max;
    else
        return x;
}
