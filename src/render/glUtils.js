// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

export function createShader(gl, vsSource, fsSource)
{
    const vsShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsShader, vsSource);
    gl.compileShader(vsShader);
    if (!gl.getShaderParameter(vsShader, gl.COMPILE_STATUS))
        console.log("vertex shader compile error: " + gl.getShaderInfoLog(vsShader));

    const fsShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsShader, fsSource);
    gl.compileShader(fsShader);
    if (!gl.getShaderParameter(fsShader, gl.COMPILE_STATUS))
        console.log("fragment shader compile error: " + gl.getShaderInfoLog(fsShader));

    var shader = gl.createProgram();
    gl.attachShader(shader, vsShader);
    gl.attachShader(shader, fsShader);
    gl.linkProgram(shader);

    return shader;
}

// Uniform and attribute locations are stable for the lifetime of a linked
// program, so they are resolved once here instead of on every frame.
export function getLocations(gl, program, uniformNames, attributeNames)
{
    const uniforms = {};
    for (const name of uniformNames)
        uniforms[name] = gl.getUniformLocation(program, name);

    const attributes = {};
    for (const name of attributeNames)
        attributes[name] = gl.getAttribLocation(program, name);

    return { uniforms, attributes };
}
