// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.
//
// GLSL sources, copied verbatim from the original file.

export const pointVertexShader = `
    attribute vec2 attrPosition;
    attribute vec3 attrColor;
    uniform vec2 domainSize;
    uniform float pointSize;
    uniform float drawDisk;

    varying vec3 fragColor;
    varying float fragDrawDisk;

    void main() {
    vec4 screenTransform =
        vec4(2.0 / domainSize.x, 2.0 / domainSize.y, -1.0, -1.0);
    gl_Position =
        vec4(attrPosition * screenTransform.xy + screenTransform.zw, 0.0, 1.0);

    gl_PointSize = pointSize;
    fragColor = attrColor;
    fragDrawDisk = drawDisk;
    }
`;

export const pointFragmentShader = `
    precision mediump float;
    varying vec3 fragColor;
    varying float fragDrawDisk;

    void main() {
        if (fragDrawDisk == 1.0) {
            float rx = 0.5 - gl_PointCoord.x;
            float ry = 0.5 - gl_PointCoord.y;
            float r2 = rx * rx + ry * ry;
            if (r2 > 0.25)
                discard;
        }
        gl_FragColor = vec4(fragColor, 1.0);
    }
`;

export const meshVertexShader = `
    attribute vec2 attrPosition;
    uniform vec2 domainSize;
    uniform vec3 color;
    uniform vec2 translation;
    uniform float scale;

    varying vec3 fragColor;

    void main() {
        vec2 v = translation + attrPosition * scale;
    vec4 screenTransform =
        vec4(2.0 / domainSize.x, 2.0 / domainSize.y, -1.0, -1.0);
    gl_Position =
        vec4(v * screenTransform.xy + screenTransform.zw, 0.0, 1.0);

    fragColor = color;
    }
`;

export const meshFragmentShader = `
    precision mediump float;
    varying vec3 fragColor;

    void main() {
        gl_FragColor = vec4(fragColor, 1.0);
    }
`;

// The debug field views draw the grid as a texture rather than as one fat point
// per cell: one quad instead of tens of thousands of sprites, and it can be
// refreshed every frame. Nearest filtering keeps the cells square, so what you
// see is the grid the solver works on.
export const fieldVertexShader = `
    attribute vec2 attrPosition;
    attribute vec2 attrUV;
    uniform vec2 domainSize;

    varying vec2 fragUV;

    void main() {
    vec4 screenTransform =
        vec4(2.0 / domainSize.x, 2.0 / domainSize.y, -1.0, -1.0);
    gl_Position =
        vec4(attrPosition * screenTransform.xy + screenTransform.zw, 0.0, 1.0);

    fragUV = attrUV;
    }
`;

export const fieldFragmentShader = `
    precision mediump float;
    uniform sampler2D field;

    varying vec2 fragUV;

    void main() {
        gl_FragColor = vec4(texture2D(field, fragUV).rgb, 1.0);
    }
`;
