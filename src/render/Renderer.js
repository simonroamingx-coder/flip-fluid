// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.
//
// Port of draw() from the original file. The GL calls, their order and every
// value uploaded to the GPU are unchanged; the only difference is that the
// programs, buffers and location lookups happen once in init() instead of
// lazily inside the per-frame draw path.

import { createShader, getLocations } from './glUtils.js';
import { FLOATS_PER_VECTOR, VERTICES_PER_VECTOR } from '../debug/fields.js';
import {
    pointVertexShader, pointFragmentShader, meshVertexShader, meshFragmentShader,
    fieldVertexShader, fieldFragmentShader, lineVertexShader, lineFragmentShader
} from './shaders.js';

const NUM_SEGS = 50;

export class Renderer
{
    constructor(gl, canvas, simWidth, simHeight)
    {
        this.gl = gl;
        this.canvas = canvas;
        this.simWidth = simWidth;
        this.simHeight = simHeight;

        this.pointShader = null;
        this.meshShader = null;
        this.fieldShader = null;
        this.lineShader = null;
        this.pointLocations = null;
        this.meshLocations = null;
        this.fieldLocations = null;
        this.lineLocations = null;

        this.pointVertexBuffer = null;
        this.pointColorBuffer = null;
        this.gridVertBuffer = null;
        this.gridColorBuffer = null;
        this.diskVertBuffer = null;
        this.diskIdBuffer = null;
        this.fieldQuadBuffer = null;
        this.lineBuffer = null;
        this.fieldTexture = null;
        this.fieldTextureSize = { width: 0, height: 0 };
    }

    init(fluid)
    {
        const gl = this.gl;

        // prepare shaders - these depend only on the sources, so creating them
        // once is enough even if the scene is rebuilt underneath them

        if (!this.pointShader) {
            this.pointShader = createShader(gl, pointVertexShader, pointFragmentShader);
            this.meshShader = createShader(gl, meshVertexShader, meshFragmentShader);
            this.fieldShader = createShader(gl, fieldVertexShader, fieldFragmentShader);
            this.lineShader = createShader(gl, lineVertexShader, lineFragmentShader);

            this.pointLocations = getLocations(
                gl, this.pointShader,
                ['domainSize', 'pointSize', 'drawDisk'],
                ['attrPosition', 'attrColor']);

            this.meshLocations = getLocations(
                gl, this.meshShader,
                ['domainSize', 'color', 'translation', 'scale'],
                ['attrPosition']);

            this.fieldLocations = getLocations(
                gl, this.fieldShader,
                ['domainSize', 'field'],
                ['attrPosition', 'attrUV']);

            this.lineLocations = getLocations(
                gl, this.lineShader,
                ['domainSize', 'color'],
                ['attrPosition']);
        }

        if (!this.fieldTexture) {
            this.fieldTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }
        this.fieldTextureSize = { width: 0, height: 0 };

        // Buffers are sized from the grid and the particle count, so a rebuilt
        // scene needs new ones. The old ones are released rather than leaked.
        this.disposeBuffers();

        // grid vertex buffer: one point per cell centre

        this.gridVertBuffer = gl.createBuffer();
        const cellCenters = new Float32Array(2 * fluid.fNumCells);
        let p = 0;

        for (let i = 0; i < fluid.fNumX; i++) {
            for (let j = 0; j < fluid.fNumY; j++) {
                cellCenters[p++] = (i + 0.5) * fluid.h;
                cellCenters[p++] = (j + 0.5) * fluid.h;
            }
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cellCenters, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this.gridColorBuffer = gl.createBuffer();

        // particle buffers

        this.pointVertexBuffer = gl.createBuffer();
        this.pointColorBuffer = gl.createBuffer();

        // disc mesh

        this.diskVertBuffer = gl.createBuffer();
        const dphi = 2.0 * Math.PI / NUM_SEGS;
        const diskVerts = new Float32Array(2 * NUM_SEGS + 2);
        p = 0;
        diskVerts[p++] = 0.0;
        diskVerts[p++] = 0.0;
        for (let i = 0; i < NUM_SEGS; i++) {
            diskVerts[p++] = Math.cos(i * dphi);
            diskVerts[p++] = Math.sin(i * dphi);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.diskVertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, diskVerts, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this.diskIdBuffer = gl.createBuffer();
        const diskIds = new Uint16Array(3 * NUM_SEGS);
        p = 0;
        for (let i = 0; i < NUM_SEGS; i++) {
            diskIds[p++] = 0;
            diskIds[p++] = 1 + i;
            diskIds[p++] = 1 + (i + 1) % NUM_SEGS;
        }

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.diskIdBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, diskIds, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

        // the quad the debug fields are drawn on: one rectangle covering the grid
        this.fieldQuadBuffer = gl.createBuffer();
        const gridWidth = fluid.fNumX * fluid.h;
        const gridHeight = fluid.fNumY * fluid.h;
        const quad = new Float32Array([
            0, 0, 0, 0,
            gridWidth, 0, 1, 0,
            0, gridHeight, 0, 1,
            gridWidth, gridHeight, 1, 1
        ]);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fieldQuadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this.lineBuffer = gl.createBuffer();
    }

    disposeBuffers()
    {
        const gl = this.gl;
        const names = ['gridVertBuffer', 'gridColorBuffer', 'pointVertexBuffer',
            'pointColorBuffer', 'diskVertBuffer', 'diskIdBuffer', 'fieldQuadBuffer'];

        for (const name of names) {
            if (this[name]) {
                gl.deleteBuffer(this[name]);
                this[name] = null;
            }
        }
    }

    // `field` is an optional debug view: { colors, scale }, where scale is in
    // cells. It takes the place of the density grid while it is on, since both
    // are cell-centred views and drawing one over the other just overdraws.
    draw(scene, field = null)
    {
        const gl = this.gl;
        const fluid = scene.fluid;

        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        if (field && field.texture)
            this.drawField(field.texture, fluid);
        else if (scene.showGrid)
            this.drawCells(fluid.cellColor, fluid, 0.9 * fluid.h / this.simWidth * this.canvas.width);

        if (field && field.lines)
            this.drawLines(field.lines.vertices, field.lines.count);

        if (scene.showParticles)
            this.drawParticles(fluid);

        this.drawObstacle(scene, fluid);
    }

    // Cell-centred points, coloured from any per-cell array. The density grid and
    // the debug fields are the same drawing with a different source of colour.
    drawCells(colors, fluid, pointSize)
    {
        const gl = this.gl;
        const loc = this.pointLocations;

        gl.useProgram(this.pointShader);
        gl.uniform2f(loc.uniforms.domainSize, this.simWidth, this.simHeight);
        gl.uniform1f(loc.uniforms.pointSize, pointSize);
        gl.uniform1f(loc.uniforms.drawDisk, 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVertBuffer);
        gl.enableVertexAttribArray(loc.attributes.attrPosition);
        gl.vertexAttribPointer(loc.attributes.attrPosition, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);

        gl.enableVertexAttribArray(loc.attributes.attrColor);
        gl.vertexAttribPointer(loc.attributes.attrColor, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, fluid.fNumCells);

        gl.disableVertexAttribArray(loc.attributes.attrPosition);
        gl.disableVertexAttribArray(loc.attributes.attrColor);

        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    // A debug field, drawn as one textured quad over the grid. One draw call and
    // an upload of three bytes per cell, against tens of thousands of sprites for
    // the point-based version - which is what allows it to be refreshed every
    // frame rather than a few times a second.
    drawField(colors, fluid)
    {
        const gl = this.gl;
        const loc = this.fieldLocations;
        const width = fluid.fNumX;
        const height = fluid.fNumY;

        gl.useProgram(this.fieldShader);
        gl.uniform2f(loc.uniforms.domainSize, this.simWidth, this.simHeight);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
        gl.uniform1i(loc.uniforms.field, 0);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

        if (this.fieldTextureSize.width !== width || this.fieldTextureSize.height !== height) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, height, 0, gl.RGB, gl.UNSIGNED_BYTE, colors);
            this.fieldTextureSize = { width, height };
        } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGB, gl.UNSIGNED_BYTE, colors);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.fieldQuadBuffer);
        gl.enableVertexAttribArray(loc.attributes.attrPosition);
        gl.vertexAttribPointer(loc.attributes.attrPosition, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(loc.attributes.attrUV);
        gl.vertexAttribPointer(loc.attributes.attrUV, 2, gl.FLOAT, false, 16, 8);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.disableVertexAttribArray(loc.attributes.attrPosition);
        gl.disableVertexAttribArray(loc.attributes.attrUV);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    // Velocity vectors, as line segments supplied by the debug layer. Green, so
    // they read against both the red pressure field and the blue cell view, and
    // do not get mistaken for the white particles.
    drawLines(vertices, count)
    {
        if (!count)
            return;

        const gl = this.gl;
        const loc = this.lineLocations;

        gl.useProgram(this.lineShader);
        gl.uniform2f(loc.uniforms.domainSize, this.simWidth, this.simHeight);
        gl.uniform3f(loc.uniforms.color, 0.25, 1.0, 0.45);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, count * FLOATS_PER_VECTOR), gl.DYNAMIC_DRAW);

        gl.enableVertexAttribArray(loc.attributes.attrPosition);
        gl.vertexAttribPointer(loc.attributes.attrPosition, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.LINES, 0, count * VERTICES_PER_VECTOR);

        gl.disableVertexAttribArray(loc.attributes.attrPosition);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    drawParticles(fluid)
    {
        const gl = this.gl;
        const loc = this.pointLocations;

        gl.clear(gl.DEPTH_BUFFER_BIT);

        const pointSize = 2.0 * fluid.particleRadius / this.simWidth * this.canvas.width;

        gl.useProgram(this.pointShader);
        gl.uniform2f(loc.uniforms.domainSize, this.simWidth, this.simHeight);
        gl.uniform1f(loc.uniforms.pointSize, pointSize);
        gl.uniform1f(loc.uniforms.drawDisk, 1.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, fluid.particlePos, gl.DYNAMIC_DRAW);

        gl.enableVertexAttribArray(loc.attributes.attrPosition);
        gl.vertexAttribPointer(loc.attributes.attrPosition, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, fluid.particleColor, gl.DYNAMIC_DRAW);

        gl.enableVertexAttribArray(loc.attributes.attrColor);
        gl.vertexAttribPointer(loc.attributes.attrColor, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, fluid.numParticles);

        gl.disableVertexAttribArray(loc.attributes.attrPosition);
        gl.disableVertexAttribArray(loc.attributes.attrColor);

        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    drawObstacle(scene, fluid)
    {
        const gl = this.gl;
        const loc = this.meshLocations;

        gl.clear(gl.DEPTH_BUFFER_BIT);

        const diskColor = [1.0, 0.0, 0.0];

        gl.useProgram(this.meshShader);
        gl.uniform2f(loc.uniforms.domainSize, this.simWidth, this.simHeight);
        gl.uniform3f(loc.uniforms.color, diskColor[0], diskColor[1], diskColor[2]);
        gl.uniform2f(loc.uniforms.translation, scene.obstacleX, scene.obstacleY);
        gl.uniform1f(loc.uniforms.scale, scene.obstacleRadius + fluid.particleRadius);

        gl.enableVertexAttribArray(loc.attributes.attrPosition);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.diskVertBuffer);
        gl.vertexAttribPointer(loc.attributes.attrPosition, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.diskIdBuffer);
        gl.drawElements(gl.TRIANGLES, 3 * NUM_SEGS, gl.UNSIGNED_SHORT, 0);

        gl.disableVertexAttribArray(loc.attributes.attrPosition);
    }
}
