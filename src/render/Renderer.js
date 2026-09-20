// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.
//
// Port of draw() from the original file. The GL calls, their order and every
// value uploaded to the GPU are unchanged; the only difference is that the
// programs, buffers and location lookups happen once in init() instead of
// lazily inside the per-frame draw path.

import { createShader, getLocations } from './glUtils.js';
import { pointVertexShader, pointFragmentShader, meshVertexShader, meshFragmentShader } from './shaders.js';

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
        this.pointLocations = null;
        this.meshLocations = null;

        this.pointVertexBuffer = null;
        this.pointColorBuffer = null;
        this.gridVertBuffer = null;
        this.gridColorBuffer = null;
        this.diskVertBuffer = null;
        this.diskIdBuffer = null;
    }

    init(fluid)
    {
        const gl = this.gl;

        // prepare shaders - these depend only on the sources, so creating them
        // once is enough even if the scene is rebuilt underneath them

        if (!this.pointShader) {
            this.pointShader = createShader(gl, pointVertexShader, pointFragmentShader);
            this.meshShader = createShader(gl, meshVertexShader, meshFragmentShader);

            this.pointLocations = getLocations(
                gl, this.pointShader,
                ['domainSize', 'pointSize', 'drawDisk'],
                ['attrPosition', 'attrColor']);

            this.meshLocations = getLocations(
                gl, this.meshShader,
                ['domainSize', 'color', 'translation', 'scale'],
                ['attrPosition']);
        }

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
    }

    disposeBuffers()
    {
        const gl = this.gl;
        const names = ['gridVertBuffer', 'gridColorBuffer', 'pointVertexBuffer',
            'pointColorBuffer', 'diskVertBuffer', 'diskIdBuffer'];

        for (const name of names) {
            if (this[name]) {
                gl.deleteBuffer(this[name]);
                this[name] = null;
            }
        }
    }

    draw(scene)
    {
        const gl = this.gl;
        const fluid = scene.fluid;

        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        if (scene.showGrid)
            this.drawGrid(fluid);

        if (scene.showParticles)
            this.drawParticles(fluid);

        this.drawObstacle(scene, fluid);
    }

    drawGrid(fluid)
    {
        const gl = this.gl;
        const loc = this.pointLocations;

        const pointSize = 0.9 * fluid.h / this.simWidth * this.canvas.width;

        gl.useProgram(this.pointShader);
        gl.uniform2f(loc.uniforms.domainSize, this.simWidth, this.simHeight);
        gl.uniform1f(loc.uniforms.pointSize, pointSize);
        gl.uniform1f(loc.uniforms.drawDisk, 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVertBuffer);
        gl.enableVertexAttribArray(loc.attributes.attrPosition);
        gl.vertexAttribPointer(loc.attributes.attrPosition, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, fluid.cellColor, gl.DYNAMIC_DRAW);

        gl.enableVertexAttribArray(loc.attributes.attrColor);
        gl.vertexAttribPointer(loc.attributes.attrColor, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, fluid.fNumCells);

        gl.disableVertexAttribArray(loc.attributes.attrPosition);
        gl.disableVertexAttribArray(loc.attributes.attrColor);

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
